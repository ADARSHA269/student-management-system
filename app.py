from pathlib import Path
import os
import secrets
from datetime import timedelta

from dotenv import load_dotenv
from flask import Flask, jsonify, send_from_directory

if __package__:
    from .auth import auth_api, create_demo_accounts, create_initial_admin
    from .database import database_uri, db
    from .modules import modules_api
    from .routes import api
else:
    from auth import auth_api, create_demo_accounts, create_initial_admin
    from database import database_uri, db
    from modules import modules_api
    from routes import api

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
load_dotenv(str(FRONTEND_DIR.parent / ".env"))


def create_app(test_config=None):
    app = Flask(__name__, static_folder=None)
    secret_key = os.environ.get("SECRET_KEY")
    if os.environ.get("VERCEL") and not secret_key:
        raise RuntimeError("SECRET_KEY must be set on Vercel.")
    app.config.from_mapping(
        SECRET_KEY=secret_key or secrets.token_hex(32),
        SQLALCHEMY_DATABASE_URI=database_uri(),
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=bool(os.environ.get("VERCEL")),
        PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
        INITIAL_ADMIN_EMAIL=os.environ.get("INITIAL_ADMIN_EMAIL", ""),
        INITIAL_ADMIN_PASSWORD=os.environ.get("INITIAL_ADMIN_PASSWORD", ""),
        DEMO_TEACHER_EMAIL=os.environ.get("DEMO_TEACHER_EMAIL", "teacher@gmail.com"),
        DEMO_TEACHER_PASSWORD=os.environ.get(
            "DEMO_TEACHER_PASSWORD", "" if os.environ.get("VERCEL") else "teach"
        ),
        DEMO_STUDENT_EMAIL=os.environ.get("DEMO_STUDENT_EMAIL", "student@gmail.com"),
        DEMO_STUDENT_PASSWORD=os.environ.get(
            "DEMO_STUDENT_PASSWORD", "" if os.environ.get("VERCEL") else "student"
        ),
    )
    if test_config:
        app.config.update(test_config)
    db.init_app(app)
    app.register_blueprint(api)
    app.register_blueprint(auth_api)
    app.register_blueprint(modules_api)

    @app.get("/")
    def index():
        return send_from_directory(str(FRONTEND_DIR), "index.html")

    @app.get("/<path:filename>")
    def frontend_asset(filename):
        if filename == "api" or filename.startswith("api/"):
            return jsonify({"error": "Not found."}), 404
        return send_from_directory(str(FRONTEND_DIR), filename)

    @app.errorhandler(404)
    def not_found(error):
        if app.config.get("TESTING") or not request_wants_html():
            return jsonify({"error": "Not found."}), 404
        return send_from_directory(str(FRONTEND_DIR), "index.html")

    with app.app_context():
        db.create_all()
        create_initial_admin(app)
        create_demo_accounts(app)

    return app


def request_wants_html():
    from flask import request

    is_api_path = request.path == "/api" or request.path.startswith("/api/")
    return request.path == "/" or not is_api_path


app = create_app()


if __name__ == "__main__":
    app.run(debug=True)
