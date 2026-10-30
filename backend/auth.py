import re
import secrets
from datetime import date
from functools import wraps

from flask import Blueprint, current_app, g, jsonify, request, session
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from werkzeug.security import check_password_hash, generate_password_hash

if __package__:
    from .database import db
    from .models import Student, User
else:
    from database import db
    from models import Student, User

auth_api = Blueprint("auth_api", __name__, url_prefix="/api/auth")
ROLES = {"admin", "faculty", "student"}
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def require_auth(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user_id = session.get("user_id")
        user = db.session.get(User, user_id) if user_id else None
        if not user or not user.is_active:
            session.pop("user_id", None)
            return jsonify({"error": "Please sign in to continue."}), 401
        g.current_user = user
        return view(*args, **kwargs)

    return wrapped


def require_roles(*roles):
    def decorate(view):
        @wraps(view)
        @require_auth
        def wrapped(*args, **kwargs):
            if g.current_user.role not in roles:
                return jsonify({"error": "You do not have permission to do that."}), 403
            return view(*args, **kwargs)

        return wrapped

    return decorate


@auth_api.before_request
def validate_csrf():
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        expected = session.get("csrf_token")
        supplied = request.headers.get("X-CSRF-Token", "")
        if not expected or not secrets.compare_digest(expected, supplied):
            return jsonify({"error": "Your session token expired. Refresh and try again."}), 403


@auth_api.get("/csrf")
def csrf_token():
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_urlsafe(32)
    return jsonify({"csrf_token": session["csrf_token"]})


@auth_api.post("/login")
def login():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "A JSON object is required."}), 400
    email = data.get("email", "")
    password = data.get("password", "")
    login_type = data.get("login_type")
    if not isinstance(email, str) or len(email) > 254 or not isinstance(password, str) or len(password) > 1024:
        return jsonify({"error": "Enter your email and password."}), 400
    if login_type not in (None, "teacher", "student"):
        return jsonify({"error": "Choose Teacher Login or Student Login."}), 400

    user = User.query.filter(func.lower(User.email) == email.strip().lower()).first()
    if not user or not user.is_active or not check_password_hash(user.password_hash, password):
        return jsonify({"error": "Email or password is incorrect."}), 401
    if login_type == "student" and user.role != "student":
        return jsonify({"error": "Email or password is incorrect."}), 401
    if login_type == "teacher" and user.role not in ("admin", "faculty"):
        return jsonify({"error": "Email or password is incorrect."}), 401

    session.clear()
    session.permanent = True
    session["user_id"] = user.id
    session["csrf_token"] = secrets.token_urlsafe(32)
    response = jsonify({"user": user.to_dict(), "csrf_token": session["csrf_token"]})
    response.headers["Cache-Control"] = "no-store"
    return response


@auth_api.post("/logout")
@require_auth
def logout():
    session.clear()
    session["csrf_token"] = secrets.token_urlsafe(32)
    return jsonify({"message": "Signed out.", "csrf_token": session["csrf_token"]})


@auth_api.get("/me")
@require_auth
def current_session():
    user = g.current_user
    result = user.to_dict()
    if user.role == "student" and user.student_id:
        student = db.session.get(Student, user.student_id)
        result["student"] = student.to_dict() if student else None
    return jsonify({"user": result})


@auth_api.get("/users")
@require_roles("admin")
def list_users():
    users = User.query.order_by(User.full_name).all()
    return jsonify({"users": [user.to_dict() for user in users]})


@auth_api.post("/users")
@require_roles("admin")
def create_user():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "A JSON object is required."}), 400

    email = data.get("email")
    name = data.get("full_name")
    role = data.get("role")
    password = data.get("password")
    if not isinstance(email, str) or len(email.strip()) > 254 or not EMAIL_PATTERN.match(email.strip()):
        return jsonify({"error": "Enter a valid email address."}), 400
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 120:
        return jsonify({"error": "Full name is required and must be 120 characters or fewer."}), 400
    if not isinstance(role, str) or role not in ROLES:
        return jsonify({"error": "Role must be admin, faculty, or student."}), 400
    if not isinstance(password, str) or len(password) < 10 or len(password) > 1024:
        return jsonify({"error": "Password must be 10 to 1024 characters."}), 400

    email = email.strip().lower()
    if User.query.filter(func.lower(User.email) == email).first():
        return jsonify({"error": "An account with this email already exists."}), 409

    student_id = None
    if role == "student":
        student_value = data.get("student_id")
        if student_value is None:
            return jsonify({"error": "A student account must be linked to a student record."}), 400
        student = (
            db.session.get(Student, student_value)
            if isinstance(student_value, int) and not isinstance(student_value, bool)
            else None
        )
        if not student:
            return jsonify({"error": "Student record not found."}), 404
        if User.query.filter_by(student_id=student.id).first():
            return jsonify({"error": "This student already has an account."}), 409
        student_id = student.id
        name = student.full_name

    user = User(
        email=email,
        full_name=name.strip(),
        role=role,
        student_id=student_id,
        password_hash=generate_password_hash(password),
    )
    db.session.add(user)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "An account with this email or student already exists."}), 409
    return jsonify({"message": "Account created.", "user": user.to_dict()}), 201


def create_initial_admin(app):
    email = app.config.get("INITIAL_ADMIN_EMAIL", "").strip().lower()
    password = app.config.get("INITIAL_ADMIN_PASSWORD", "")
    if not email and not password:
        return
    if not email or not password:
        raise RuntimeError("Set both INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD.")
    if len(password) < 10 or len(password) > 1024:
        raise RuntimeError("INITIAL_ADMIN_PASSWORD must be 10 to 1024 characters.")
    if not EMAIL_PATTERN.match(email):
        raise RuntimeError("INITIAL_ADMIN_EMAIL must be a valid email address.")
    if User.query.filter_by(role="admin").first():
        return
    if User.query.filter(func.lower(User.email) == email).first():
        raise RuntimeError("INITIAL_ADMIN_EMAIL is already used by a non-admin account.")

    admin = User(
        email=email,
        full_name="College Administrator",
        role="admin",
        password_hash=generate_password_hash(password),
    )
    db.session.add(admin)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        current_app.logger.warning("Initial admin account was created by another app worker.")


def create_demo_accounts(app):
    teacher_email = app.config["DEMO_TEACHER_EMAIL"].strip().lower()
    student_email = app.config["DEMO_STUDENT_EMAIL"].strip().lower()
    teacher_password = app.config["DEMO_TEACHER_PASSWORD"]
    student_password = app.config["DEMO_STUDENT_PASSWORD"]
    if not EMAIL_PATTERN.match(teacher_email) or not EMAIL_PATTERN.match(student_email):
        raise RuntimeError("Demo account email settings must be valid email addresses.")
    if not teacher_password or not student_password:
        current_app.logger.warning(
            "Demo accounts were not initialized. Set both DEMO_TEACHER_PASSWORD "
            "and DEMO_STUDENT_PASSWORD to seed them."
        )
        return

    if not User.query.filter(func.lower(User.email) == teacher_email).first():
        db.session.add(User(
            email=teacher_email,
            full_name="Demo Teacher",
            role="faculty",
            password_hash=generate_password_hash(teacher_password),
        ))
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            current_app.logger.warning("Demo teacher account already exists.")

    if User.query.filter(func.lower(User.email) == student_email).first():
        return

    student = Student.query.filter(func.lower(Student.email) == student_email).first()
    if not student:
        student_id = "STU-DEMO"
        suffix = 1
        while Student.query.filter_by(student_id=student_id).first():
            student_id = "STU-DEMO-{}".format(suffix)
            suffix += 1
        student = Student(
            student_id=student_id,
            full_name="Demo Student",
            email=student_email,
            phone="",
            gender="Prefer not to say",
            date_of_birth=date(2005, 1, 1),
            course="General Studies",
            department="General",
            address="",
            enrollment_date=date.today(),
            status="Active",
        )
        db.session.add(student)
        try:
            db.session.flush()
        except IntegrityError:
            db.session.rollback()
            current_app.logger.warning("Demo student profile could not be created.")
            return

    if User.query.filter_by(student_id=student.id).first():
        db.session.rollback()
        current_app.logger.warning(
            "Demo student account was not created because the profile already has an account."
        )
        return

    db.session.add(User(
        email=student_email,
        full_name=student.full_name,
        role="student",
        student_id=student.id,
        password_hash=generate_password_hash(student_password),
    ))
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        current_app.logger.warning("Demo student account already exists.")
