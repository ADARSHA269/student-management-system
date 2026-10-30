const API_URL = "/api";
const state = {
  user: null,
  csrf: "",
  students: [],
  courses: [],
  exams: [],
  fees: [],
  analytics: [],
  currentStudent: null,
  searchTimer: null,
  teacherSearchTimer: null,
  loginType: "teacher",
};
const byId = (id) => document.getElementById(id);
const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function initials(name) {
  return String(name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function colorFor(name) {
  const colors = [["#eae6ff", "#6658c8"], ["#e2f4ee", "#348969"], ["#fff0e3", "#bf7940"], ["#e5f1fb", "#4d83a9"], ["#fce9ef", "#b2637a"]];
  const index = Array.from(String(name || "")).reduce((sum, char) => sum + char.charCodeAt(0), 0) % colors.length;
  return `background:${colors[index][0]};color:${colors[index][1]}`;
}

function amount(value) {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));
}

function showToast(message, isError) {
  const toast = document.createElement("div");
  toast.className = `toast${isError ? " error" : ""}`;
  toast.textContent = message;
  byId("toast-region").appendChild(toast);
  window.setTimeout(() => toast.remove(), 3500);
}

async function api(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = { ...(options.headers || {}) };
  if (mutationMethods.has(method)) headers["X-CSRF-Token"] = state.csrf;
  if (options.body && !headers.Accept) headers["Content-Type"] = "application/json";
  const response = await fetch(`${API_URL}${path}`, { ...options, method, headers, credentials: "same-origin" });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("The server returned an invalid response.");
  }
  if (response.status === 401 && state.user) {
    state.user = null;
    byId("app-shell").hidden = true;
    byId("login-screen").hidden = false;
  }
  if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("campusly-theme", theme);
  byId("theme-button").textContent = theme === "dark" ? "☀" : "☾";
}

function applyRoleVisibility() {
  const role = state.user.role;
  byId("dashboard-charts").classList.toggle("single-chart", role !== "admin");
  document.querySelectorAll(".admin-dashboard-content").forEach((element) => {
    element.hidden = role !== "admin";
  });
  document.querySelectorAll("[data-roles]").forEach((element) => {
    element.hidden = !element.dataset.roles.split(",").includes(role);
  });
  document.querySelectorAll(".admin-only").forEach((element) => { element.hidden = role !== "admin"; });
  document.querySelectorAll(".faculty-only").forEach((element) => {
    element.hidden = role !== "admin" && role !== "faculty";
  });
  document.querySelectorAll(".staff-only").forEach((element) => {
    element.hidden = role !== "admin" && role !== "faculty";
  });
}

function showApplication(user) {
  state.user = user;
  byId("login-screen").hidden = true;
  byId("app-shell").hidden = false;
  byId("sidebar-name").textContent = user.full_name;
  byId("sidebar-role").textContent = user.role === "faculty"
    ? "Teacher"
    : user.role.charAt(0).toUpperCase() + user.role.slice(1);
  byId("sidebar-avatar").textContent = initials(user.full_name);
  byId("top-avatar").textContent = initials(user.full_name);
  applyRoleVisibility();
  refresh().catch((error) => showToast(error.message, true));
}

function renderStudentRow(student, recent) {
  const statusClass = student.status === "Inactive" ? " inactive" : "";
  const isAdmin = state.user.role === "admin";
  const isStaff = isAdmin || state.user.role === "faculty";
  const idColumn = recent
    ? `<td class="student-id">${escapeHtml(student.student_id)}</td><td>${escapeHtml(student.course)}</td><td>${escapeHtml(student.department)}</td>`
    : `<td class="student-id">${escapeHtml(student.student_id)}</td><td>${escapeHtml(student.phone || "—")}</td><td>${escapeHtml(student.course)}</td><td>${escapeHtml(student.department)}</td><td>${escapeHtml(student.enrollment_date)}</td>`;
  const actions = `<div class="row-actions"><button class="row-action" data-action="view" data-id="${student.id}" aria-label="View ${escapeHtml(student.full_name)}" title="View details">↗</button>${isStaff ? `<button class="row-action" data-action="edit" data-id="${student.id}" aria-label="Edit ${escapeHtml(student.full_name)}" title="Edit">✎</button>` : ""}${isAdmin ? `<button class="row-action delete" data-action="delete" data-id="${student.id}" aria-label="Delete ${escapeHtml(student.full_name)}" title="Delete">×</button>` : ""}</div>`;
  return `<tr><td><div class="student-cell"><div class="avatar" style="${colorFor(student.full_name)}">${escapeHtml(initials(student.full_name))}</div><div><div class="student-name">${escapeHtml(student.full_name)}</div><div class="student-email">${escapeHtml(student.email)}</div></div></div></td>${idColumn}<td><span class="status-pill${statusClass}"><i></i>${escapeHtml(student.status)}</span></td><td>${actions}</td></tr>`;
}

function fillSelect(select, items, placeholder, valueOf, labelOf) {
  const previous = select.value;
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>${items.map((item) => `<option value="${escapeHtml(valueOf(item))}">${escapeHtml(labelOf(item))}</option>`).join("")}`;
  if (items.some((item) => String(valueOf(item)) === previous)) select.value = previous;
}

function fillStudentSelects() {
  const options = state.students.map((student) => ({ id: student.id, label: `${student.full_name} (${student.student_id})` }));
  for (const id of ["result-student", "fee-student", "user-student"]) {
    const element = byId(id);
    if (element) fillSelect(element, options, "Select a student", (item) => item.id, (item) => item.label);
  }
}

function updateFilters(students) {
  fillSelect(byId("course-filter"), [...new Set(students.map((student) => student.course))].sort().map((name) => ({ name })), "All courses", (item) => item.name, (item) => item.name);
  fillSelect(byId("department-filter"), [...new Set(students.map((student) => student.department))].sort().map((name) => ({ name })), "All departments", (item) => item.name, (item) => item.name);
}

async function loadStats() {
  const [stats, analytics] = await Promise.all([api("/dashboard/stats"), api("/dashboard/analytics")]);
  byId("total-students").textContent = stats.total_students;
  byId("active-students").textContent = stats.active_students;
  byId("faculty-count").textContent = stats.faculty;
  byId("course-count").textContent = stats.courses;
  byId("department-count").textContent = stats.departments;
  byId("attendance-percent").textContent = `${stats.attendance_percent}%`;
  byId("fees-collected").textContent = amount(stats.fees_collected);
  byId("new-this-month").textContent = stats.new_this_month;
  state.analytics = analytics.months;
  drawCharts();
}

async function loadTeacherDashboard() {
  const params = new URLSearchParams();
  const selectedDate = byId("teacher-dashboard-date").value || new Date().toISOString().slice(0, 10);
  const search = byId("teacher-student-search").value.trim();
  params.set("date", selectedDate);
  if (search) params.set("search", search);
  const result = await api(`/teacher/dashboard?${params.toString()}`);
  byId("teacher-total-students").textContent = result.total_students;
  byId("teacher-total-classes").textContent = result.total_classes;
  byId("teacher-attendance-label").textContent = selectedDate === new Date().toISOString().slice(0, 10)
    ? "Today's attendance"
    : `Attendance · ${selectedDate}`;
  byId("teacher-today-attendance").textContent =
    `${result.today.present + result.today.late} / ${result.total_students}`;
  byId("teacher-today-foot").textContent =
    `${result.today.marked} marked · ${result.today.unmarked} unmarked`;
  byId("teacher-attendance-percent").textContent = `${result.attendance_percent}%`;
  byId("teacher-students-body").innerHTML = result.students.map((student) => {
    const status = student.attendance_status || "Not marked";
    const statusClass = status === "Absent" || status === "Excused" ? " inactive" : "";
    return `<tr><td><div class="student-name">${escapeHtml(student.full_name)}</div></td><td class="student-id">${escapeHtml(student.student_id)}</td><td>${escapeHtml(student.email)}</td><td>${escapeHtml(student.course)}</td><td><span class="status-pill${statusClass}">${escapeHtml(status)}</span></td></tr>`;
  }).join("");
  byId("teacher-students-empty").hidden = result.students.length > 0;
}

async function loadStudentDashboard() {
  const result = await api("/student/dashboard");
  const student = result.student;
  const summary = result.summary;
  state.students = [student];
  byId("student-total-classes").textContent = summary.total_classes;
  byId("student-classes-attended").textContent = summary.classes_attended;
  byId("student-classes-absent").textContent = summary.classes_absent;
  byId("student-attendance-percent").textContent = `${summary.attendance_percent}%`;
  byId("student-dashboard-profile").innerHTML = [
    ["Student ID", student.student_id], ["Full name", student.full_name],
    ["Email", student.email], ["Phone number", student.phone],
    ["Course", student.course], ["Department", student.department],
  ].map(([label, value]) => `<div class="detail-item"><small>${escapeHtml(label)}</small><span>${escapeHtml(value || "—")}</span></div>`).join("");
  byId("student-attendance-body").innerHTML = result.attendance.map((record) => {
    const statusClass = record.status === "Absent" || record.status === "Excused" ? " inactive" : "";
    return `<tr><td>${escapeHtml(record.attendance_date)}</td><td><span class="status-pill${statusClass}">${escapeHtml(record.status)}</span></td></tr>`;
  }).join("");
  byId("student-attendance-empty").hidden = result.attendance.length > 0;
}

async function loadStudents() {
  const params = new URLSearchParams();
  const search = byId("search-input").value.trim();
  const course = byId("course-filter").value;
  const department = byId("department-filter").value;
  if (search) params.set("search", search);
  if (course) params.set("course", course);
  if (department) params.set("department", department);
  const query = params.toString();
  const result = await api(`/students${query ? `?${query}` : ""}`);
  const students = result.students;
  if (!search && !course && !department) {
    state.students = students;
    fillStudentSelects();
  }
  byId("student-count").textContent = students.length;
  byId("students-table-body").innerHTML = students.map((student) => renderStudentRow(student, false)).join("");
  byId("directory-empty").hidden = students.length > 0;
}

async function loadRecentStudents() {
  const result = await api("/students");
  state.students = result.students;
  const recent = result.students.slice(0, 5);
  byId("recent-table-body").innerHTML = recent.map((student) => renderStudentRow(student, true)).join("");
  byId("recent-empty").hidden = recent.length > 0;
  byId("view-all").hidden = result.students.length === 0;
  updateFilters(result.students);
  fillStudentSelects();
}

async function refresh() {
  if (state.user.role === "admin") {
    await Promise.all([loadStats(), loadRecentStudents()]);
  } else if (state.user.role === "faculty") {
    await loadTeacherDashboard();
  } else {
    await loadStudentDashboard();
  }
  await loadStudents();
  if (state.user.role !== "student") await loadCourses();
  if (document.querySelector('[data-page-section="attendance"]:not([hidden])')) await loadAttendance();
  if (document.querySelector('[data-page-section="exams"]:not([hidden])')) await loadExams();
  if (document.querySelector('[data-page-section="fees"]:not([hidden])')) await loadFees();
}

function setPage(page) {
  const link = document.querySelector(`.nav-link[data-page="${page}"]`);
  if (link && link.dataset.roles && !link.dataset.roles.split(",").includes(state.user.role)) return;
  const sectionId = page === "overview" ? "overview-page" : page === "students" ? "students-page" : `${page}-page`;
  const section = byId(sectionId);
  if (!section) return;
  document.querySelectorAll(".page-section").forEach((item) => { item.hidden = item !== section; });
  byId("breadcrumb").textContent = page === "overview" ? "Overview" : page.charAt(0).toUpperCase() + page.slice(1);
  document.querySelectorAll(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.page === page));
  byId("sidebar").classList.remove("open");
  const loaders = {
    students: loadStudents,
    attendance: loadAttendance,
    exams: loadExams,
    fees: loadFees,
    courses: loadCourses,
    reports: loadAttendanceReport,
    users: loadUsers,
  };
  if (loaders[page]) loaders[page]().catch((error) => showToast(error.message, true));
}

function openStudentForm(student) {
  byId("student-form").reset();
  byId("form-error").hidden = true;
  byId("record-id").value = student ? student.id : "";
  byId("modal-title").textContent = student ? "Edit student" : "Add a student";
  byId("save-student").textContent = student ? "Save changes" : "Save student";
  if (student) {
    for (const field of ["full_name", "email", "phone", "gender", "date_of_birth", "course", "department", "address", "enrollment_date", "status"]) {
      byId(field).value = student[field] || "";
    }
  } else {
    byId("enrollment_date").value = new Date().toISOString().slice(0, 10);
    byId("status").value = "Active";
  }
  byId("student-modal").hidden = false;
  byId("full_name").focus();
}

function closeStudentForm() {
  byId("student-modal").hidden = true;
}

async function submitStudent(event) {
  event.preventDefault();
  const id = byId("record-id").value;
  const body = Object.fromEntries(new FormData(byId("student-form")).entries());
  byId("save-student").disabled = true;
  try {
    const result = await api(id ? `/students/${encodeURIComponent(id)}` : "/students", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(body),
    });
    closeStudentForm();
    showToast(result.message, false);
    await refresh();
  } catch (error) {
    byId("form-error").textContent = error.message;
    byId("form-error").hidden = false;
  } finally {
    byId("save-student").disabled = false;
  }
}

async function showStudent(id) {
  try {
    const [result, attendanceResult, summary] = await Promise.all([
      api(`/students/${encodeURIComponent(id)}`),
      api(`/attendance/students/${encodeURIComponent(id)}`),
      api(`/attendance/summary?student_id=${encodeURIComponent(id)}`),
    ]);
    const student = result.student;
    state.currentStudent = student;
    byId("details-title").textContent = student.student_id;
    byId("details-pdf-button").href = `/api/reports/students/${encodeURIComponent(student.id)}.pdf`;
    const details = `<div class="detail-hero"><div class="avatar" style="${colorFor(student.full_name)}">${escapeHtml(initials(student.full_name))}</div><div><strong>${escapeHtml(student.full_name)}</strong><span>${escapeHtml(student.email)}</span></div><span class="status-pill${student.status === "Inactive" ? " inactive" : ""}"><i></i>${escapeHtml(student.status)}</span></div><div class="detail-grid">${[
      ["Phone number", student.phone], ["Gender", student.gender], ["Date of birth", student.date_of_birth],
      ["Course", student.course], ["Department", student.department], ["Enrollment date", student.enrollment_date],
      ["Address", student.address],
    ].map(([label, value]) => `<div class="detail-item"><small>${escapeHtml(label)}</small><span>${escapeHtml(value || "—")}</span></div>`).join("")}</div>`;
    const attendanceRows = attendanceResult.attendance.map((record) =>
      `<tr><td>${escapeHtml(record.attendance_date)}</td><td>${escapeHtml(record.status)}</td></tr>`
    ).join("");
    byId("student-details").innerHTML = `${details}<section class="student-detail-attendance"><h3>Attendance · ${summary.attendance_percent}%</h3><div class="table-wrap"><table><thead><tr><th>DATE</th><th>STATUS</th></tr></thead><tbody>${attendanceRows}</tbody></table>${attendanceRows ? "" : '<div class="empty-state"><strong>No attendance recorded yet</strong></div>'}</div></section>`;
    byId("details-modal").hidden = false;
  } catch (error) {
    showToast(error.message, true);
  }
}

async function handleTableAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const student = state.students.find((item) => String(item.id) === button.dataset.id);
  if (button.dataset.action === "view") return showStudent(button.dataset.id);
  if (button.dataset.action === "edit" && student) return openStudentForm(student);
  if (button.dataset.action === "delete" && student) {
    if (!window.confirm(`Delete ${student.full_name} (${student.student_id})? This cannot be undone.`)) return;
    try {
      const result = await api(`/students/${encodeURIComponent(student.id)}`, { method: "DELETE" });
      showToast(result.message, false);
      await refresh();
    } catch (error) {
      showToast(error.message, true);
    }
  }
}

async function loadCourses() {
  const result = await api("/courses");
  state.courses = result.courses;
  byId("courses-table-body").innerHTML = state.courses.map((course) => `<tr><td>${escapeHtml(course.code || "—")}</td><td>${escapeHtml(course.name)}</td><td>${escapeHtml(course.department)}</td><td>${escapeHtml(course.credits == null ? "—" : course.credits)}</td></tr>`).join("");
  byId("courses-empty").hidden = state.courses.length > 0;
  const options = state.courses.map((course) => course.name);
  fillSelect(byId("exam-course"), options, "Select a course", (item) => item, (item) => item);
}

async function loadAttendance() {
  const selectedDate = byId("attendance-date").value;
  const query = selectedDate ? `?date=${encodeURIComponent(selectedDate)}` : "";
  const [studentsResult, attendanceResult, summary] = await Promise.all([
    api("/students"),
    api(`/attendance${query}`),
    api("/attendance/summary"),
  ]);
  const students = state.user.role === "student"
    ? studentsResult.students
    : studentsResult.students.filter((student) => student.status === "Active");
  const records = new Map(attendanceResult.attendance.map((record) => [record.student_id, record.status]));
  byId("attendance-table-body").innerHTML = students.map((student) => {
    const current = records.get(student.id) || "";
    const status = state.user.role === "student"
      ? `<span class="status-pill${current === "Absent" ? " inactive" : ""}">${escapeHtml(current || "Not recorded")}</span>`
      : `<select class="attendance-select" data-student-id="${student.id}" aria-label="Attendance for ${escapeHtml(student.full_name)}"><option value="">Not marked</option>${["Present", "Absent", "Late", "Excused"].map((item) => `<option${item === current ? " selected" : ""}>${item}</option>`).join("")}</select>`;
    return `<tr><td>${escapeHtml(student.full_name)}</td><td>${escapeHtml(student.student_id)}</td><td>${escapeHtml(student.course)}</td><td>${status}</td></tr>`;
  }).join("");
  byId("attendance-empty").hidden = students.length > 0;
  byId("attendance-present").textContent = summary.present_days;
  byId("attendance-absent").textContent = summary.absent_days;
  byId("attendance-rate").textContent = `${summary.attendance_percent}%`;
}

async function saveAttendance() {
  const records = Array.from(document.querySelectorAll(".attendance-select"))
    .filter((select) => select.value)
    .map((select) => ({ student_id: Number(select.dataset.studentId), status: select.value }));
  if (!records.length) return showToast("Choose an attendance status before saving.", true);
  try {
    const result = await api("/attendance", {
      method: "POST",
      body: JSON.stringify({ date: byId("attendance-date").value, records }),
    });
    showToast(result.message, false);
    await loadAttendance();
    if (state.user.role === "faculty") await loadTeacherDashboard();
    else await loadStats();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadAttendanceReport() {
  const params = new URLSearchParams();
  if (byId("attendance-report-start").value) {
    params.set("start_date", byId("attendance-report-start").value);
  }
  if (byId("attendance-report-end").value) {
    params.set("end_date", byId("attendance-report-end").value);
  }
  const result = await api(`/attendance/report${params.size ? `?${params.toString()}` : ""}`);
  byId("attendance-report-body").innerHTML = result.daily.map((row) =>
    `<tr><td>${escapeHtml(row.date)}</td><td>${row.total}</td><td>${row.present}</td><td>${row.absent}</td><td>${row.late}</td><td>${row.excused}</td></tr>`
  ).join("");
  byId("attendance-report-students").innerHTML = result.students.map((row) =>
    `<tr><td>${escapeHtml(row.student.full_name)}</td><td class="student-id">${escapeHtml(row.student.student_id)}</td><td>${row.total_classes}</td><td>${row.classes_attended}</td><td>${row.classes_absent}</td><td>${row.attendance_percent}%</td></tr>`
  ).join("");
  byId("attendance-report-empty").hidden = result.daily.length > 0;
  byId("attendance-report-students-empty").hidden = result.students.length > 0;
}

async function loadExams() {
  const result = await api("/exams");
  state.exams = result.exams;
  const rows = [];
  for (const exam of state.exams) {
    for (const resultItem of exam.results) {
      rows.push(`<tr><td>${escapeHtml(exam.title)}</td><td>${escapeHtml(exam.course)}</td><td>${escapeHtml(exam.exam_date)}</td><td>${escapeHtml(resultItem.student_name)}</td><td>${resultItem.marks} / ${exam.total_marks} (${resultItem.percentage}%)</td><td><span class="grade-pill">${escapeHtml(resultItem.grade)}</span></td><td>${resultItem.marks >= exam.total_marks * 0.6 ? "Pass" : "Review"}</td></tr>`);
    }
  }
  byId("exams-table-body").innerHTML = rows.join("");
  byId("exams-empty").hidden = rows.length > 0;
  fillSelect(byId("result-exam"), state.exams, "Select an examination", (exam) => exam.id, (exam) => `${exam.title} — ${exam.course} (${exam.total_marks} marks)`);
}

async function loadFees() {
  const result = await api("/fees");
  state.fees = result.fees;
  byId("fees-table-body").innerHTML = state.fees.map((fee) => `<tr><td>${escapeHtml(fee.student_name)}<div class="student-email">${escapeHtml(fee.student_id)}</div></td><td>${escapeHtml(fee.description)}</td><td>${amount(fee.amount)}</td><td>${amount(fee.paid)}</td><td>${amount(fee.pending)}</td><td>${escapeHtml(fee.due_date)}</td><td><span class="status-pill${fee.status === "Pending" ? " inactive" : ""}">${escapeHtml(fee.status)}</span></td><td>${state.user.role === "admin" && fee.pending > 0 ? `<button class="button button-light fee-payment-button" data-fee-id="${fee.id}" data-pending="${fee.pending}">Record payment</button>` : ""}</td></tr>`).join("");
  byId("fees-empty").hidden = state.fees.length > 0;
  byId("fee-total").textContent = amount(state.fees.reduce((sum, fee) => sum + fee.amount, 0));
  byId("fee-paid").textContent = amount(state.fees.reduce((sum, fee) => sum + fee.paid, 0));
  byId("fee-pending").textContent = amount(state.fees.reduce((sum, fee) => sum + fee.pending, 0));
}

async function loadUsers() {
  const result = await api("/auth/users");
  byId("users-table-body").innerHTML = result.users.map((user) => `<tr><td>${escapeHtml(user.full_name)}</td><td>${escapeHtml(user.email)}</td><td><span class="role-pill">${escapeHtml(user.role)}</span></td><td>${user.is_active ? "Active" : "Inactive"}</td></tr>`).join("");
  byId("users-empty").hidden = result.users.length > 0;
}

function drawBarChart(canvasId, key, formatter, suffix) {
  const canvas = byId(canvasId);
  if (!canvas || canvas.offsetWidth === 0) return;
  const count = Number(document.querySelector(`[data-chart="${key}"]`).value);
  const rows = state.analytics.slice(-count);
  const width = canvas.clientWidth;
  const height = 180;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  const isDark = document.documentElement.dataset.theme === "dark";
  const muted = isDark ? "#a5acc2" : "#9298ac";
  const line = isDark ? "#353b53" : "#eceef4";
  const purple = isDark ? "#9b8cff" : "#6658d3";
  const values = rows.map((row) => Number(row[key === "attendance" ? "attendance_percent" : "fees_collected"] || 0));
  const max = Math.max(...values, key === "attendance" ? 100 : 1);
  const top = 14;
  const bottom = height - 31;
  const usable = bottom - top;
  const gap = 18;
  const barWidth = Math.max(12, Math.min(34, (width - 48 - gap * (rows.length - 1)) / rows.length));
  const totalWidth = rows.length * barWidth + Math.max(0, rows.length - 1) * gap;
  const start = Math.max(34, (width - totalWidth) / 2);
  context.font = "10px DM Sans, sans-serif";
  context.textAlign = "center";
  rows.forEach((row, index) => {
    const value = values[index];
    const barHeight = value ? Math.max(3, value / max * usable) : 2;
    const x = start + index * (barWidth + gap);
    const y = bottom - barHeight;
    context.fillStyle = value ? purple : line;
    context.beginPath();
    context.roundRect(x, y, barWidth, barHeight, 5);
    context.fill();
    context.fillStyle = muted;
    context.fillText(`${formatter(value)}${suffix}`, x + barWidth / 2, Math.max(10, y - 5));
    context.fillText(row.month, x + barWidth / 2, height - 9);
  });
  canvas.title = rows.map((row) => `${row.month}: ${formatter(Number(row[key === "attendance" ? "attendance_percent" : "fees_collected"] || 0))}${suffix}`).join(" | ");
}

function drawCharts() {
  drawBarChart("attendance-chart", "attendance", (value) => value, "%");
  drawBarChart("fees-chart", "fees", amount, "");
}

async function handleLogin(event) {
  event.preventDefault();
  byId("login-button").disabled = true;
  byId("login-error").hidden = true;
  try {
    const result = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: byId("login-email").value,
        password: byId("login-password").value,
        login_type: state.loginType,
      }),
    });
    state.csrf = result.csrf_token;
    byId("login-password").value = "";
    showApplication(result.user);
  } catch (error) {
    byId("login-error").textContent = error.message;
    byId("login-error").hidden = false;
  } finally {
    byId("login-button").disabled = false;
  }
}

function setLoginType(type) {
  state.loginType = type;
  document.querySelectorAll(".login-mode").forEach((button) => {
    const active = button.dataset.loginType === type;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const isStudent = type === "student";
  byId("login-description").textContent = `Sign in to your ${isStudent ? "student" : "teacher"} account to continue.`;
  byId("login-button").textContent = isStudent ? "Student Login" : "Teacher Login";
  byId("login-foot").textContent = "Need another account? Ask your college administrator.";
  byId("login-error").hidden = true;
}

async function handleLogout() {
  try {
    const result = await api("/auth/logout", { method: "POST" });
    state.csrf = result.csrf_token;
  } catch (error) {
    showToast(error.message, true);
  }
  state.user = null;
  byId("app-shell").hidden = true;
  byId("login-screen").hidden = false;
  byId("login-form").reset();
  try {
    const response = await fetch(`${API_URL}/auth/csrf`, { credentials: "same-origin" });
    state.csrf = (await response.json()).csrf_token;
  } catch (error) {
    showToast("Unable to start a new sign-in session.", true);
  }
}

async function submitJsonForm(event, path, successMessage, onSuccess) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = Object.fromEntries(new FormData(form).entries());
  if (Object.prototype.hasOwnProperty.call(body, "student_id")) body.student_id = Number(body.student_id);
  if (Object.prototype.hasOwnProperty.call(body, "credits")) body.credits = Number(body.credits);
  if (Object.prototype.hasOwnProperty.call(body, "total_marks")) body.total_marks = Number(body.total_marks);
  try {
    const result = await api(path, { method: "POST", body: JSON.stringify(body) });
    showToast(result.message || successMessage, false);
    form.reset();
    if (onSuccess) await onSuccess(result);
    await refresh();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function submitExamResult(event) {
  event.preventDefault();
  const examId = byId("result-exam").value;
  const marks = Number(byId("result-marks").value);
  const studentId = Number(byId("result-student").value);
  try {
    const result = await api(`/exams/${encodeURIComponent(examId)}/results`, {
      method: "POST",
      body: JSON.stringify({ results: [{ student_id: studentId, marks }] }),
    });
    showToast(result.message, false);
    byId("result-marks").value = "";
    await loadExams();
  } catch (error) {
    showToast(error.message, true);
  }
}

function openPayment(feeId, pending) {
  byId("payment-form").reset();
  byId("payment-fee-id").value = feeId;
  byId("payment-amount").max = pending;
  byId("payment-amount").value = pending;
  byId("payment-error").hidden = true;
  byId("payment-modal").hidden = false;
}

async function submitPayment(event) {
  event.preventDefault();
  const feeId = byId("payment-fee-id").value;
  try {
    const result = await api(`/fees/${encodeURIComponent(feeId)}/payments`, {
      method: "POST",
      body: JSON.stringify({ amount: Number(byId("payment-amount").value), reference: byId("payment-reference").value }),
    });
    byId("payment-modal").hidden = true;
    showToast(result.message, false);
    await loadFees();
    await loadStats();
  } catch (error) {
    byId("payment-error").textContent = error.message;
    byId("payment-error").hidden = false;
  }
}

function wireEvents() {
  byId("login-form").addEventListener("submit", handleLogin);
  document.querySelectorAll(".login-mode").forEach((button) => {
    button.addEventListener("click", () => setLoginType(button.dataset.loginType));
  });
  byId("logout-button").addEventListener("click", handleLogout);
  document.querySelectorAll(".nav-link").forEach((link) => link.addEventListener("click", () => setPage(link.dataset.page)));
  byId("view-all").addEventListener("click", () => setPage("students"));
  byId("add-student-top").addEventListener("click", () => openStudentForm());
  byId("add-student-list").addEventListener("click", () => openStudentForm());
  byId("empty-add").addEventListener("click", () => openStudentForm());
  byId("close-modal").addEventListener("click", () => { byId("student-modal").hidden = true; });
  byId("cancel-modal").addEventListener("click", () => { byId("student-modal").hidden = true; });
  byId("student-form").addEventListener("submit", submitStudent);
  byId("close-details").addEventListener("click", () => { byId("details-modal").hidden = true; });
  byId("details-close-button").addEventListener("click", () => { byId("details-modal").hidden = true; });
  byId("details-edit-button").addEventListener("click", () => {
    byId("details-modal").hidden = true;
    if (state.currentStudent) openStudentForm(state.currentStudent);
  });
  byId("details-print-button").addEventListener("click", () => window.print());
  byId("menu-button").addEventListener("click", () => byId("sidebar").classList.toggle("open"));
  byId("theme-button").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  byId("search-input").addEventListener("input", () => {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => loadStudents().catch((error) => showToast(error.message, true)), 180);
  });
  byId("course-filter").addEventListener("change", () => loadStudents().catch((error) => showToast(error.message, true)));
  byId("department-filter").addEventListener("change", () => loadStudents().catch((error) => showToast(error.message, true)));
  byId("recent-table-body").addEventListener("click", handleTableAction);
  byId("students-table-body").addEventListener("click", handleTableAction);
  byId("attendance-date").addEventListener("change", () => loadAttendance().catch((error) => showToast(error.message, true)));
  byId("save-attendance").addEventListener("click", saveAttendance);
  byId("teacher-mark-attendance").addEventListener("click", () => setPage("attendance"));
  byId("teacher-dashboard-date").value = new Date().toISOString().slice(0, 10);
  byId("teacher-dashboard-date").addEventListener("change", () => loadTeacherDashboard().catch((error) => showToast(error.message, true)));
  byId("teacher-student-search").addEventListener("input", () => {
    window.clearTimeout(state.teacherSearchTimer);
    state.teacherSearchTimer = window.setTimeout(
      () => loadTeacherDashboard().catch((error) => showToast(error.message, true)),
      180,
    );
  });
  byId("load-attendance-report").addEventListener("click", () => loadAttendanceReport().catch((error) => showToast(error.message, true)));
  byId("exam-form").addEventListener("submit", (event) => submitJsonForm(event, "/exams", "Examination created.", loadExams));
  byId("result-form").addEventListener("submit", submitExamResult);
  byId("course-form").addEventListener("submit", (event) => submitJsonForm(event, "/courses", "Course added.", loadCourses));
  byId("fee-form").addEventListener("submit", (event) => submitJsonForm(event, "/fees", "Fee record added.", loadFees));
  byId("user-form").addEventListener("submit", (event) => submitJsonForm(event, "/auth/users", "Account created.", loadUsers));
  byId("user-role").addEventListener("change", () => {
    byId("user-student").closest(".field").hidden = byId("user-role").value !== "student";
  });
  byId("fees-table-body").addEventListener("click", (event) => {
    const button = event.target.closest(".fee-payment-button");
    if (button) openPayment(button.dataset.feeId, Number(button.dataset.pending));
  });
  byId("payment-form").addEventListener("submit", submitPayment);
  byId("close-payment").addEventListener("click", () => { byId("payment-modal").hidden = true; });
  byId("cancel-payment").addEventListener("click", () => { byId("payment-modal").hidden = true; });
  document.querySelectorAll(".chart-range").forEach((select) => select.addEventListener("change", drawCharts));
  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) backdrop.hidden = true;
  }));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") document.querySelectorAll(".modal-backdrop").forEach((modal) => { modal.hidden = true; });
  });
  byId("help-link").addEventListener("click", (event) => {
    event.preventDefault();
    showToast("Choose a module from the navigation to manage college records.", false);
  });
  byId("today-label").textContent = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date());
  byId("attendance-date").value = new Date().toISOString().slice(0, 10);
  window.addEventListener("resize", drawCharts);
}

async function initialize() {
  const savedTheme = localStorage.getItem("campusly-theme");
  setTheme(savedTheme === "dark" ? "dark" : "light");
  try {
    const csrfResponse = await fetch(`${API_URL}/auth/csrf`, { credentials: "same-origin" });
    const csrfData = await csrfResponse.json();
    state.csrf = csrfData.csrf_token;
    const result = await api("/auth/me");
    showApplication(result.user);
  } catch (error) {
    state.user = null;
    byId("app-shell").hidden = true;
    byId("login-screen").hidden = false;
    if (error.message !== "Please sign in to continue.") {
      byId("login-error").textContent = error.message;
      byId("login-error").hidden = false;
    }
  }
}

wireEvents();
initialize();
