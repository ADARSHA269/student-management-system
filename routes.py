import re
import uuid
from datetime import date

from flask import Blueprint, g, jsonify, request
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

if __package__:
    from .auth import require_auth, require_roles
    from .database import db
    from .models import Attendance, Course, ExamResult, FeePayment, FeeRecord, Student, User
else:
    from auth import require_auth, require_roles
    from database import db
    from models import Attendance, Course, ExamResult, FeePayment, FeeRecord, Student, User

api = Blueprint("api", __name__, url_prefix="/api")
GENDERS = {"Female", "Male", "Non-binary", "Prefer not to say"}
STATUSES = {"Active", "Inactive"}
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
STUDENT_FIELDS = (
    "full_name",
    "email",
    "phone",
    "gender",
    "date_of_birth",
    "course",
    "department",
    "address",
    "enrollment_date",
    "status",
)


def find_student(identifier):
    if identifier.isdigit():
        student = db.session.get(Student, int(identifier))
        if student:
            return student
    return Student.query.filter_by(student_id=identifier).first()


def validate_student(data):
    if not isinstance(data, dict):
        return None, "A JSON object is required."

    cleaned = {}
    required = ("full_name", "email", "gender", "date_of_birth", "course", "department")
    for field in required:
        value = data.get(field)
        if not isinstance(value, str) or not value.strip():
            return None, "{} is required.".format(field.replace("_", " ").capitalize())
        cleaned[field] = value.strip()

    for field in ("phone", "address"):
        value = data.get(field, "")
        if not isinstance(value, str):
            return None, "{} must be text.".format(field.capitalize())
        cleaned[field] = value.strip()

    if len(cleaned["full_name"]) > 120:
        return None, "Full name must be 120 characters or fewer."
    if len(cleaned["email"]) > 254 or not EMAIL_PATTERN.match(cleaned["email"]):
        return None, "Enter a valid email address."
    if len(cleaned["phone"]) > 30 or len(cleaned["address"]) > 300:
        return None, "Phone or address is too long."
    if cleaned["gender"] not in GENDERS:
        return None, "Choose a valid gender."
    for field in ("course", "department"):
        if len(cleaned[field]) > 100:
            return None, "{} must be 100 characters or fewer.".format(field.capitalize())

    for field in ("date_of_birth", "enrollment_date"):
        value = data.get(field)
        if field == "enrollment_date" and value in (None, ""):
            cleaned[field] = date.today()
            continue
        if not isinstance(value, str):
            return None, "{} must use YYYY-MM-DD format.".format(field.replace("_", " "))
        try:
            parsed = date.fromisoformat(value)
        except ValueError:
            return None, "{} must use YYYY-MM-DD format.".format(field.replace("_", " "))
        if field == "date_of_birth" and parsed > date.today():
            return None, "Date of birth cannot be in the future."
        cleaned[field] = parsed

    status = data.get("status", "Active")
    if not isinstance(status, str) or status not in STATUSES:
        return None, "Status must be Active or Inactive."
    cleaned["status"] = status
    cleaned["email"] = cleaned["email"].lower()
    return cleaned, None


@api.get("/students")
@require_auth
def get_students():
    query = Student.query
    if g.current_user.role == "student":
        query = query.filter_by(id=g.current_user.student_id)
    search = request.args.get("search", "").strip()
    course = request.args.get("course", "").strip()
    department = request.args.get("department", "").strip()

    if search:
        pattern = "%{}%".format(search)
        query = query.filter(
            db.or_(
                Student.full_name.ilike(pattern),
                Student.email.ilike(pattern),
                Student.student_id.ilike(pattern),
            )
        )
    if course:
        query = query.filter(Student.course == course)
    if department:
        query = query.filter(Student.department == department)

    students = query.order_by(Student.full_name).all()
    return jsonify({"students": [student.to_dict() for student in students]})


@api.get("/students/<identifier>")
@require_auth
def get_student(identifier):
    student = find_student(identifier)
    if not student:
        return jsonify({"error": "Student not found."}), 404
    if g.current_user.role == "student" and student.id != g.current_user.student_id:
        return jsonify({"error": "You do not have permission to view this student."}), 403
    return jsonify({"student": student.to_dict()})


@api.post("/students")
@require_roles("admin", "faculty")
def create_student():
    data, error = validate_student(request.get_json(silent=True))
    if error:
        return jsonify({"error": error}), 400
    duplicate = Student.query.filter(
        func.lower(Student.email) == data["email"]
    ).first()
    if duplicate:
        return jsonify({"error": "A student with this email already exists."}), 409

    student = Student(
        student_id="STU-{}".format(uuid.uuid4().hex[:8].upper()),
        **data
    )
    db.session.add(student)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "A student with this email or student ID already exists."}), 409
    return jsonify({"message": "Student created successfully.", "student": student.to_dict()}), 201


@api.put("/students/<identifier>")
@require_roles("admin", "faculty")
def update_student(identifier):
    student = find_student(identifier)
    if not student:
        return jsonify({"error": "Student not found."}), 404

    data, error = validate_student(request.get_json(silent=True))
    if error:
        return jsonify({"error": error}), 400
    duplicate = Student.query.filter(
        func.lower(Student.email) == data["email"],
        Student.id != student.id,
    ).first()
    if duplicate:
        return jsonify({"error": "A student with this email already exists."}), 409

    for field in STUDENT_FIELDS:
        setattr(student, field, data[field])
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "A student with this email already exists."}), 409
    return jsonify({"message": "Student updated successfully.", "student": student.to_dict()})


@api.delete("/students/<identifier>")
@require_roles("admin")
def delete_student(identifier):
    student = find_student(identifier)
    if not student:
        return jsonify({"error": "Student not found."}), 404
    has_records = any((
        User.query.filter_by(student_id=student.id).first(),
        Attendance.query.filter_by(student_id=student.id).first(),
        ExamResult.query.filter_by(student_id=student.id).first(),
        FeeRecord.query.filter_by(student_id=student.id).first(),
    ))
    if has_records:
        return jsonify({"error": "This student has linked account, attendance, exam, or fee records. Keep the student record to preserve its history."}), 409
    db.session.delete(student)
    db.session.commit()
    return jsonify({"message": "Student deleted successfully."})


@api.get("/dashboard/stats")
@require_auth
def dashboard_stats():
    if g.current_user.role == "student":
        student = db.session.get(Student, g.current_user.student_id)
        total = 1 if student else 0
        active = 1 if student and student.status == "Active" else 0
        courses = 1 if student else 0
        departments = 1 if student else 0
        new_this_month = 0
        faculty = 0
    else:
        total = Student.query.count()
        active = Student.query.filter_by(status="Active").count()
        course_names = (
            [row[0].lower() for row in db.session.query(Student.course).distinct().all()]
            + [row[0].lower() for row in db.session.query(Course.name).distinct().all()]
        )
        department_names = (
            [row[0].lower() for row in db.session.query(Student.department).distinct().all()]
            + [row[0].lower() for row in db.session.query(Course.department).distinct().all()]
        )
        courses = len(set(course_names))
        departments = len(set(department_names))
        faculty = User.query.filter_by(role="faculty", is_active=True).count()
        today = date.today()
        month_start = today.replace(day=1)
        next_month = date(
            today.year + (1 if today.month == 12 else 0),
            1 if today.month == 12 else today.month + 1,
            1,
        )
        new_this_month = Student.query.filter(
            Student.enrollment_date >= month_start,
            Student.enrollment_date < next_month,
        ).count()

    if g.current_user.role == "student":
        attendance_records = Attendance.query.filter_by(student_id=g.current_user.student_id).count()
        attendance_present = Attendance.query.filter(
            Attendance.student_id == g.current_user.student_id,
            Attendance.status.in_(("Present", "Late")),
        ).count()
        fees_collected = 0
    else:
        attendance_records = Attendance.query.count()
        attendance_present = Attendance.query.filter(Attendance.status.in_(("Present", "Late"))).count()
        fees_collected = (
            float(db.session.query(func.coalesce(func.sum(FeePayment.amount), 0)).scalar())
            if g.current_user.role == "admin" else 0
        )

    return jsonify(
        {
            "total_students": total,
            "active_students": active,
            "courses": courses,
            "departments": departments,
            "new_this_month": new_this_month,
            "faculty": faculty,
            "attendance_percent": round(attendance_present * 100.0 / attendance_records, 1)
            if attendance_records else 0,
            "fees_collected": fees_collected,
        }
    )


@api.get("/teacher/dashboard")
@require_roles("admin", "faculty")
def teacher_dashboard():
    selected_date_value = request.args.get("date", date.today().isoformat())
    try:
        selected_date = date.fromisoformat(selected_date_value)
    except (TypeError, ValueError):
        return jsonify({"error": "Date must use YYYY-MM-DD format."}), 400

    students_query = Student.query.filter_by(status="Active")
    search = request.args.get("search", "").strip()
    if search:
        if len(search) > 120:
            return jsonify({"error": "Search must be 120 characters or fewer."}), 400
        pattern = "%{}%".format(search)
        students_query = students_query.filter(
            db.or_(Student.full_name.ilike(pattern), Student.student_id.ilike(pattern))
        )
    students = students_query.order_by(Student.full_name).all()

    active_student_ids = {
        row[0] for row in db.session.query(Student.id).filter_by(status="Active").all()
    }
    active_total = len(active_student_ids)
    today_records = [
        record for record in Attendance.query.filter_by(attendance_date=selected_date).all()
        if record.student_id in active_student_ids
    ]
    statuses = {record.student_id: record.status for record in today_records}
    attendance_counts = {
        status: sum(1 for record in today_records if record.status == status)
        for status in ("Present", "Absent", "Late", "Excused")
    }
    attendance_total = Attendance.query.count()
    attended_total = Attendance.query.filter(Attendance.status.in_(("Present", "Late"))).count()
    return jsonify({
        "date": selected_date.isoformat(),
        "total_students": active_total,
        "total_classes": db.session.query(
            func.count(func.distinct(Attendance.attendance_date))
        ).scalar() or 0,
        "attendance_percent": round(attended_total * 100.0 / attendance_total, 1)
        if attendance_total else 0,
        "today": {
            "present": attendance_counts["Present"],
            "absent": attendance_counts["Absent"],
            "late": attendance_counts["Late"],
            "excused": attendance_counts["Excused"],
            "marked": len(today_records),
            "unmarked": max(active_total - len(today_records), 0),
        },
        "students": [
            {
                **student.to_dict(),
                "attendance_status": statuses.get(student.id),
            }
            for student in students
        ],
    })
