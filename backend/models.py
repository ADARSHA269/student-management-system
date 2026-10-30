from datetime import date, datetime
from sqlalchemy import Index, func

if __package__:
    from .database import db
else:
    from database import db


class Student(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.String(20), unique=True, nullable=False, index=True)
    full_name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(254), unique=True, nullable=False, index=True)
    phone = db.Column(db.String(30), nullable=False, default="")
    gender = db.Column(db.String(20), nullable=False)
    date_of_birth = db.Column(db.Date, nullable=False)
    course = db.Column(db.String(100), nullable=False)
    department = db.Column(db.String(100), nullable=False)
    address = db.Column(db.String(300), nullable=False, default="")
    enrollment_date = db.Column(db.Date, nullable=False, default=date.today)
    status = db.Column(db.String(10), nullable=False, default="Active")

    def to_dict(self):
        return {
            "id": self.id,
            "student_id": self.student_id,
            "full_name": self.full_name,
            "email": self.email,
            "phone": self.phone,
            "gender": self.gender,
            "date_of_birth": self.date_of_birth.isoformat(),
            "course": self.course,
            "department": self.department,
            "address": self.address,
            "enrollment_date": self.enrollment_date.isoformat(),
            "status": self.status,
        }


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(254), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False, index=True)
    full_name = db.Column(db.String(120), nullable=False)
    student_id = db.Column(db.Integer, db.ForeignKey("student.id"), nullable=True, unique=True)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    __table_args__ = (Index("uq_user_email_lower", func.lower(email), unique=True),)

    def to_dict(self):
        return {
            "id": self.id,
            "email": self.email,
            "role": self.role,
            "full_name": self.full_name,
            "student_id": self.student_id,
            "is_active": self.is_active,
        }


class Course(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(30), unique=True, nullable=False)
    name = db.Column(db.String(120), nullable=False, index=True)
    department = db.Column(db.String(100), nullable=False)
    credits = db.Column(db.Integer, nullable=False, default=3)

    def to_dict(self):
        return {
            "id": self.id,
            "code": self.code,
            "name": self.name,
            "department": self.department,
            "credits": self.credits,
        }


class Attendance(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey("student.id"), nullable=False, index=True)
    attendance_date = db.Column(db.Date, nullable=False, index=True)
    status = db.Column(db.String(12), nullable=False)
    marked_by = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    __table_args__ = (
        db.UniqueConstraint("student_id", "attendance_date", name="uq_attendance_student_day"),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "student_id": self.student_id,
            "attendance_date": self.attendance_date.isoformat(),
            "status": self.status,
        }


class Exam(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    course_id = db.Column(db.Integer, db.ForeignKey("course.id"), nullable=True)
    title = db.Column(db.String(120), nullable=False)
    course_name = db.Column(db.String(120), nullable=False)
    exam_date = db.Column(db.Date, nullable=False)
    total_marks = db.Column(db.Float, nullable=False)

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "course_id": self.course_id,
            "course": self.course_name,
            "exam_date": self.exam_date.isoformat(),
            "total_marks": self.total_marks,
        }


class ExamResult(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    exam_id = db.Column(db.Integer, db.ForeignKey("exam.id"), nullable=False, index=True)
    student_id = db.Column(db.Integer, db.ForeignKey("student.id"), nullable=False, index=True)
    marks = db.Column(db.Float, nullable=False)
    grade = db.Column(db.String(3), nullable=False)
    __table_args__ = (
        db.UniqueConstraint("exam_id", "student_id", name="uq_exam_result_student"),
    )


class FeeRecord(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey("student.id"), nullable=False, index=True)
    description = db.Column(db.String(160), nullable=False)
    amount = db.Column(db.Numeric(12, 2), nullable=False)
    due_date = db.Column(db.Date, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


class FeePayment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    fee_id = db.Column(db.Integer, db.ForeignKey("fee_record.id"), nullable=False, index=True)
    amount = db.Column(db.Numeric(12, 2), nullable=False)
    paid_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    reference = db.Column(db.String(100), nullable=False, default="")
