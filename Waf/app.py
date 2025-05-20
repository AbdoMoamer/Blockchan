from flask import Flask, request, render_template_string, abort, redirect, url_for, make_response, session, flash, send_file
from waf_middleware import waf, BLOCKED_IPS
from flask_wtf import FlaskForm, CSRFProtect
from wtforms import StringField, SubmitField, PasswordField, HiddenField, IntegerField
from wtforms.validators import DataRequired, NumberRange
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import bleach
import os
from waf_rules import is_malicious, is_lfi, is_rfi, is_cmd_injection, is_path_traversal
from attack_logger import log_attack
import time

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('WAF_SECRET_KEY', 'supersecretkey')

# Rate Limiting
limiter = Limiter(get_remote_address, app=app, default_limits=["10 per minute"])

# CSRF Protection
csrf = CSRFProtect(app)

# Settings (in-memory for demo)
SETTINGS = {
    'admin_password': os.environ.get('WAF_ADMIN_PASS', 'admin123'),
    'rate_limit': 10,  # requests per minute
    'block_duration': 10,  # minutes
    'enabled_protections': {
        'SQLi': True,
        'XSS': True,
        'LFI': True,
        'RFI': True,
        'CMD Injection': True,
        'Path Traversal': True,
    },
    'language': 'en',  # 'en' or 'ar'
}

class InputForm(FlaskForm):
    input = StringField('Input', validators=[DataRequired()])
    submit = SubmitField('Submit')

class ScannerForm(FlaskForm):
    scan_input = StringField('Scan Input', validators=[DataRequired()])
    scan = SubmitField('Scan')

class AdminLoginForm(FlaskForm):
    password = PasswordField('Password', validators=[DataRequired()])
    submit = SubmitField('Login')

class BlockIPForm(FlaskForm):
    ip = HiddenField('ip', validators=[DataRequired()])
    action = HiddenField('action', validators=[DataRequired()])
    submit = SubmitField('Confirm')

class SettingsForm(FlaskForm):
    new_password = PasswordField('New Admin Password')
    rate_limit = IntegerField('Rate Limit (requests/minute)', validators=[DataRequired(), NumberRange(min=1, max=1000)])
    block_duration = IntegerField('Block Duration (minutes)', validators=[DataRequired(), NumberRange(min=1, max=1440)])
    enable_sqli = SubmitField('SQLi')
    enable_xss = SubmitField('XSS')
    enable_lfi = SubmitField('LFI')
    enable_rfi = SubmitField('RFI')
    enable_cmd = SubmitField('CMD Injection')
    enable_path = SubmitField('Path Traversal')
    sqli = HiddenField()
    xss = HiddenField()
    lfi = HiddenField()
    rfi = HiddenField()
    cmd = HiddenField()
    path = HiddenField()
    language = StringField('Language')
    submit = SubmitField('Save Settings')

class ClearLogsForm(FlaskForm):
    submit = SubmitField('Clear Attack Logs')

class UnblockAllForm(FlaskForm):
    submit = SubmitField('Unblock All IPs')

# Helper: login required decorator
from functools import wraps
def admin_login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('admin_auth'):
            return redirect(url_for('admin_login'))
        return f(*args, **kwargs)
    return decorated

@app.before_request
def before_request_func():
    # Allow access to login/logout/static/favicon even if IP is blocked
    allowed_paths = [
        '/admin/login', '/admin/logout', '/static', '/favicon.ico'
    ]
    if any(request.path.startswith(path) for path in allowed_paths):
        return None  # Skip WAF for these paths
    return waf()

@app.route("/", methods=["GET", "POST"])
@limiter.limit("10 per minute")
def index():
    message = None
    error = request.args.get('error')
    form = InputForm()
    scanner_form = ScannerForm()
    scan_result = None
    scan_type = None
    scan_color = None
    if scanner_form.validate_on_submit() and scanner_form.scan.data:
        user_input = scanner_form.scan_input.data
        # Use WAF rules to scan input
        attack_type = is_malicious(user_input)
        if not attack_type:
            if is_lfi(user_input):
                attack_type = "LFI"
            elif is_rfi(user_input):
                attack_type = "RFI"
            elif is_cmd_injection(user_input):
                attack_type = "CMD Injection"
            elif is_path_traversal(user_input):
                attack_type = "Path Traversal"
        if attack_type:
            scan_result = f"Blocked: {attack_type} Detected"
            scan_type = attack_type
            scan_color = "danger"
            # Log the scan as an attack event
            log_attack(
                request.remote_addr,
                attack_type,
                user_input,
                request.headers.get('User-Agent', ''),
                request.url
            )
        else:
            scan_result = "Input is safe."
            scan_type = None
            scan_color = "success"
    elif form.validate_on_submit():
        user_input = bleach.clean(form.input.data)
        return render_template_string(TEMPLATE, message=f"Submitted: {user_input}", error=error, form=form, scanner_form=scanner_form, scan_result=scan_result, scan_type=scan_type, scan_color=scan_color)
    return render_template_string(TEMPLATE, message=message, error=error, form=form, scanner_form=scanner_form, scan_result=scan_result, scan_type=scan_type, scan_color=scan_color)

@app.errorhandler(403)
def forbidden(e):
    return render_template_string(TEMPLATE, message=None, error="You have been blocked due to a detected attack or unsafe activity.", form=InputForm(), scanner_form=ScannerForm(), scan_result=None, scan_type=None, scan_color=None), 403

@app.errorhandler(429)
def ratelimit_handler(e):
    return render_template_string(TEMPLATE, message=None, error="Rate limit exceeded. Please try again later.", form=InputForm(), scanner_form=ScannerForm(), scan_result=None, scan_type=None, scan_color=None), 429

# Admin login/logout
@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    form = AdminLoginForm()
    if form.validate_on_submit():
        if form.password.data == SETTINGS['admin_password']:
            session['admin_auth'] = True
            flash("Logged in successfully!", "success")
            BLOCKED_IPS.clear()
            return redirect(url_for('admin_dashboard'))
        else:
            flash("Wrong password.", "danger")
    return render_template_string(ADMIN_LOGIN_TEMPLATE, form=form)

@app.route("/admin/logout")
def admin_logout():
    session.pop('admin_auth', None)
    flash("Logged out.", "info")
    return redirect(url_for('admin_login'))

# Admin dashboard home
@app.route("/admin")
def admin_root():
    return redirect(url_for('admin_dashboard'))

@app.route("/admin/dashboard")
@admin_login_required
def admin_dashboard():
    # Stats: total events, blocked IPs, last event
    try:
        with open("attacks.log", "r") as f:
            logs = f.readlines()
    except Exception:
        logs = []
    total_events = len(logs)
    blocked_ips = list(BLOCKED_IPS.keys())
    last_event = logs[-1] if logs else None
    return render_template_string(ADMIN_DASHBOARD_TEMPLATE, total_events=total_events, blocked_ips=blocked_ips, last_event=last_event)

# Security Events page
@app.route("/admin/events")
@admin_login_required
def admin_events():
    block_form = BlockIPForm()
    try:
        with open("attacks.log", "r") as f:
            logs = f.readlines()
    except Exception:
        logs = []
    # Parse logs for table
    events = []
    for log in logs:
        parts = log.strip().split(" | ")
        if len(parts) >= 3:
            time_part = parts[0][1:20] if parts[0].startswith("[") else ""
            ip_part = parts[1].replace("IP: ", "")
            type_part = parts[2].replace("Type: ", "")
            desc = parts[3] if len(parts) > 3 else ""
            sev = "High" if type_part in ["SQLi", "XSS", "LFI", "RFI", "CMD Injection"] else "Medium"
            events.append({
                'time': time_part,
                'ip': ip_part,
                'type': type_part,
                'severity': sev,
                'desc': desc,
            })
    filter_type = request.args.get('type', '')
    filtered_events = [e for e in events if (not filter_type or e['type'] == filter_type)]
    return render_template_string(ADMIN_EVENTS_TEMPLATE, events=filtered_events, all_types=sorted(set(e['type'] for e in events)), filter_type=filter_type, block_form=block_form)

# Blocked IPs page
@app.route("/admin/blocked", methods=["GET", "POST"])
@admin_login_required
def admin_blocked():
    block_form = BlockIPForm()
    if block_form.validate_on_submit():
        ip = block_form.ip.data
        action = block_form.action.data
        if action == 'unblock':
            BLOCKED_IPS.pop(ip, None)
            flash(f"Unblocked IP: {ip}", "success")
        return redirect(url_for('admin_blocked'))
    blocked_ips = list(BLOCKED_IPS.keys())
    return render_template_string(ADMIN_BLOCKED_TEMPLATE, blocked_ips=blocked_ips, block_form=block_form)

# Download logs
@app.route("/admin/logs")
@admin_login_required
def admin_logs():
    try:
        return send_file("attacks.log", as_attachment=True)
    except Exception:
        flash("No log file found.", "danger")
        return redirect(url_for('admin_dashboard'))

# Settings page
@app.route("/admin/settings", methods=["GET", "POST"])
@admin_login_required
def admin_settings():
    form = SettingsForm()
    clear_logs_form = ClearLogsForm()
    unblock_all_form = UnblockAllForm()
    # Set initial values
    form.rate_limit.data = SETTINGS['rate_limit']
    form.block_duration.data = SETTINGS['block_duration']
    form.language.data = SETTINGS['language']
    # Handle settings update
    if form.validate_on_submit():
        if form.new_password.data:
            SETTINGS['admin_password'] = form.new_password.data
            flash("Admin password updated!", "success")
        SETTINGS['rate_limit'] = form.rate_limit.data
        SETTINGS['block_duration'] = form.block_duration.data
        # Protections
        SETTINGS['enabled_protections']['SQLi'] = bool(request.form.get('sqli'))
        SETTINGS['enabled_protections']['XSS'] = bool(request.form.get('xss'))
        SETTINGS['enabled_protections']['LFI'] = bool(request.form.get('lfi'))
        SETTINGS['enabled_protections']['RFI'] = bool(request.form.get('rfi'))
        SETTINGS['enabled_protections']['CMD Injection'] = bool(request.form.get('cmd'))
        SETTINGS['enabled_protections']['Path Traversal'] = bool(request.form.get('path'))
        # Language
        SETTINGS['language'] = request.form.get('language', 'en')
        flash("Settings updated!", "success")
        return redirect(url_for('admin_settings'))
    # Handle clear logs
    if clear_logs_form.submit.data and clear_logs_form.validate_on_submit():
        try:
            open("attacks.log", "w").close()
            flash("Attack logs cleared!", "info")
        except Exception:
            flash("Failed to clear logs.", "danger")
        return redirect(url_for('admin_settings'))
    # Handle unblock all
    if unblock_all_form.submit.data and unblock_all_form.validate_on_submit():
        BLOCKED_IPS.clear()
        flash("All IPs unblocked!", "info")
        return redirect(url_for('admin_settings'))
    return render_template_string(ADMIN_SETTINGS_TEMPLATE, form=form, clear_logs_form=clear_logs_form, unblock_all_form=unblock_all_form, settings=SETTINGS)

# --- Templates ---
ADMIN_LOGIN_TEMPLATE = '''
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Admin Login - WAF</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body>
<div class="container mt-5">
    <h2>Admin Login</h2>
    {% with messages = get_flashed_messages(with_categories=true) %}
      {% if messages %}
        {% for cat, msg in messages %}
          <div class="alert alert-{{cat}}">{{ msg }}</div>
        {% endfor %}
      {% endif %}
    {% endwith %}
        <form method="post">
        {{ form.hidden_tag() }}
        <div class="mb-3">{{ form.password(class_="form-control", placeholder="Password") }}</div>
        {{ form.submit(class_="btn btn-primary") }}
    </form>
</div>
</body>
</html>
'''

ADMIN_DASHBOARD_TEMPLATE = '''
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>WAF Admin Dashboard</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>body{background:#f8f9fa;} .sidebar{min-width:200px;max-width:200px;}</style>
</head>
<body>
<div class="d-flex">
    <div class="sidebar bg-dark text-white p-3 vh-100">
        <h4>WAF Dashboard</h4>
        <ul class="nav flex-column">
            <li class="nav-item"><a href="/admin/dashboard" class="nav-link text-white">Dashboard Home</a></li>
            <li class="nav-item"><a href="/admin/events" class="nav-link text-white">Security Events</a></li>
            <li class="nav-item"><a href="/admin/blocked" class="nav-link text-white">IP Management</a></li>
            <li class="nav-item"><a href="/admin/logs" class="nav-link text-white">Download Logs</a></li>
            <li class="nav-item"><a href="/admin/settings" class="nav-link text-white">Settings</a></li>
            <li class="nav-item"><a href="/admin/logout" class="nav-link text-white">Logout</a></li>
        </ul>
    </div>
    <div class="flex-grow-1 p-4">
        <h3>Dashboard Home</h3>
        <div class="row mb-4">
            <div class="col-md-4">
                <div class="card text-bg-primary mb-3"><div class="card-body"><h5 class="card-title">Total Events</h5><p class="card-text fs-3">{{ total_events }}</p></div></div>
            </div>
            <div class="col-md-4">
                <div class="card text-bg-danger mb-3"><div class="card-body"><h5 class="card-title">Blocked IPs</h5><p class="card-text fs-3">{{ blocked_ips|length }}</p></div></div>
            </div>
            <div class="col-md-4">
                <div class="card text-bg-success mb-3"><div class="card-body"><h5 class="card-title">Last Event</h5><p class="card-text small">{{ last_event or 'No events yet.' }}</p></div></div>
            </div>
        </div>
        <a href="/admin/events" class="btn btn-primary">View Security Events</a>
        <a href="/admin/blocked" class="btn btn-danger">Manage Blocked IPs</a>
        <a href="/admin/logs" class="btn btn-secondary">Download Logs</a>
    </div>
</div>
</body>
</html>
'''

ADMIN_EVENTS_TEMPLATE = '''
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Security Events - WAF</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>body{background:#f8f9fa;} .sidebar{min-width:200px;max-width:200px;}</style>
</head>
<body>
<div class="d-flex">
    <div class="sidebar bg-dark text-white p-3 vh-100">
        <h4>WAF Dashboard</h4>
        <ul class="nav flex-column">
            <li class="nav-item"><a href="/admin/dashboard" class="nav-link text-white">Dashboard Home</a></li>
            <li class="nav-item"><a href="/admin/events" class="nav-link text-white active">Security Events</a></li>
            <li class="nav-item"><a href="/admin/blocked" class="nav-link text-white">IP Management</a></li>
            <li class="nav-item"><a href="/admin/logs" class="nav-link text-white">Download Logs</a></li>
            <li class="nav-item"><a href="/admin/settings" class="nav-link text-white">Settings</a></li>
            <li class="nav-item"><a href="/admin/logout" class="nav-link text-white">Logout</a></li>
        </ul>
    </div>
    <div class="flex-grow-1 p-4">
        <h3>Security Events</h3>
        <form method="get" class="mb-2">
            <label>Filter by Type:</label>
            <select name="type" onchange="this.form.submit()" class="form-select d-inline-block w-auto">
                <option value="">All</option>
                {% for t in all_types %}
                <option value="{{ t }}" {% if filter_type==t %}selected{% endif %}>{{ t }}</option>
                {% endfor %}
            </select>
        </form>
        <table class="table table-bordered table-striped bg-white">
            <thead><tr><th>#</th><th>Time</th><th>IP Address</th><th>Type</th><th>Severity</th><th>Description</th></tr></thead>
            <tbody>
            {% for e in events %}
            <tr>
                <td>{{ loop.index }}</td>
                <td>{{ e.time }}</td>
                <td>{{ e.ip }}</td>
                <td>{{ e.type }}</td>
                <td><span class="badge bg-danger">{{ e.severity }}</span></td>
                <td>{{ e.desc }}</td>
            </tr>
            {% endfor %}
            </tbody>
        </table>
        <a href="/admin/dashboard" class="btn btn-secondary mt-3">Back to Dashboard</a>
    </div>
</div>
</body>
</html>
'''

ADMIN_BLOCKED_TEMPLATE = '''
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Blocked IPs - WAF</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>body{background:#f8f9fa;} .sidebar{min-width:200px;max-width:200px;}</style>
</head>
<body>
<div class="d-flex">
    <div class="sidebar bg-dark text-white p-3 vh-100">
        <h4>WAF Dashboard</h4>
        <ul class="nav flex-column">
            <li class="nav-item"><a href="/admin/dashboard" class="nav-link text-white">Dashboard Home</a></li>
            <li class="nav-item"><a href="/admin/events" class="nav-link text-white">Security Events</a></li>
            <li class="nav-item"><a href="/admin/blocked" class="nav-link text-white active">IP Management</a></li>
            <li class="nav-item"><a href="/admin/logs" class="nav-link text-white">Download Logs</a></li>
            <li class="nav-item"><a href="/admin/settings" class="nav-link text-white">Settings</a></li>
            <li class="nav-item"><a href="/admin/logout" class="nav-link text-white">Logout</a></li>
        </ul>
    </div>
    <div class="flex-grow-1 p-4">
        <h3>Blocked IPs</h3>
        {% with messages = get_flashed_messages(with_categories=true) %}
          {% if messages %}
            {% for cat, msg in messages %}
              <div class="alert alert-{{cat}}">{{ msg }}</div>
            {% endfor %}
          {% endif %}
        {% endwith %}
        <table class="table table-bordered bg-white">
            <thead><tr><th>#</th><th>IP Address</th><th>Actions</th></tr></thead>
            <tbody>
            {% for ip in blocked_ips %}
            <tr>
                <td>{{ loop.index }}</td>
                <td>{{ ip }}</td>
                <td>
                    <form method="post" style="display:inline-block;">
                        {{ block_form.hidden_tag() }}
                        <input type="hidden" name="ip" value="{{ ip }}">
                        <input type="hidden" name="action" value="unblock">
                        <button type="submit" class="btn btn-sm btn-success" onclick="return confirm('Unblock this IP?')">Unblock</button>
                    </form>
                </td>
            </tr>
            {% endfor %}
            </tbody>
        </table>
        <a href="/admin/dashboard" class="btn btn-secondary mt-3">Back to Dashboard</a>
    </div>
</div>
</body>
</html>
'''

ADMIN_SETTINGS_TEMPLATE = '''
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Settings - WAF</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>body{background:#f8f9fa;} .sidebar{min-width:200px;max-width:200px;}</style>
</head>
<body>
<div class="d-flex">
    <div class="sidebar bg-dark text-white p-3 vh-100">
        <h4>WAF Dashboard</h4>
        <ul class="nav flex-column">
            <li class="nav-item"><a href="/admin/dashboard" class="nav-link text-white">Dashboard Home</a></li>
            <li class="nav-item"><a href="/admin/events" class="nav-link text-white">Security Events</a></li>
            <li class="nav-item"><a href="/admin/blocked" class="nav-link text-white">IP Management</a></li>
            <li class="nav-item"><a href="/admin/logs" class="nav-link text-white">Download Logs</a></li>
            <li class="nav-item"><a href="/admin/settings" class="nav-link text-white active">Settings</a></li>
            <li class="nav-item"><a href="/admin/logout" class="nav-link text-white">Logout</a></li>
        </ul>
    </div>
    <div class="flex-grow-1 p-4">
        <h3>Settings</h3>
        {% with messages = get_flashed_messages(with_categories=true) %}
          {% if messages %}
            {% for cat, msg in messages %}
              <div class="alert alert-{{cat}}">{{ msg }}</div>
            {% endfor %}
          {% endif %}
        {% endwith %}
        <form method="post" class="mb-4">
            {{ form.hidden_tag() }}
            <div class="mb-3">
                {{ form.new_password.label }}
                {{ form.new_password(class_="form-control", placeholder="Leave blank to keep current") }}
            </div>
            <div class="mb-3">
                {{ form.rate_limit.label }}
                {{ form.rate_limit(class_="form-control") }}
            </div>
            <div class="mb-3">
                {{ form.block_duration.label }}
                {{ form.block_duration(class_="form-control") }}
            </div>
            <div class="mb-3">
                <label><b>Protections:</b></label><br>
                <input type="checkbox" name="sqli" value="1" {% if settings['enabled_protections']['SQLi'] %}checked{% endif %}> SQLi
                <input type="checkbox" name="xss" value="1" {% if settings['enabled_protections']['XSS'] %}checked{% endif %}> XSS
                <input type="checkbox" name="lfi" value="1" {% if settings['enabled_protections']['LFI'] %}checked{% endif %}> LFI
                <input type="checkbox" name="rfi" value="1" {% if settings['enabled_protections']['RFI'] %}checked{% endif %}> RFI
                <input type="checkbox" name="cmd" value="1" {% if settings['enabled_protections']['CMD Injection'] %}checked{% endif %}> CMD Injection
                <input type="checkbox" name="path" value="1" {% if settings['enabled_protections']['Path Traversal'] %}checked{% endif %}> Path Traversal
            </div>
            <div class="mb-3">
                <label><b>Language:</b></label>
                <select name="language" class="form-select">
                    <option value="en" {% if settings['language']=='en' %}selected{% endif %}>English</option>
                    <option value="ar" {% if settings['language']=='ar' %}selected{% endif %}>العربية</option>
                </select>
            </div>
            {{ form.submit(class_="btn btn-primary") }}
        </form>
        <form method="post" style="display:inline-block;">
            {{ clear_logs_form.hidden_tag() }}
            {{ clear_logs_form.submit(class_="btn btn-warning") }}
        </form>
        <form method="post" style="display:inline-block;">
            {{ unblock_all_form.hidden_tag() }}
            {{ unblock_all_form.submit(class_="btn btn-danger ms-2") }}
        </form>
        <hr>
        <h5>Current Settings</h5>
        <ul>
            <li><b>Admin Password:</b> ******</li>
            <li><b>Rate Limit:</b> {{ settings['rate_limit'] }} requests/minute</li>
            <li><b>Block Duration:</b> {{ settings['block_duration'] }} minutes</li>
            <li><b>Protections:</b> {{ settings['enabled_protections'] }}</li>
            <li><b>Language:</b> {{ settings['language'] }}</li>
        </ul>
    </div>
</div>
</body>
</html>
'''

TEMPLATE = '''
<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Web Application Firewall - WAF</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background: #f8f9fa; }
        .container { max-width: 600px; margin-top: 40px; }
        .logo { font-size: 2.5rem; font-weight: bold; color: #0d6efd; }
    </style>
</head>
<body>
    <div class="container shadow p-4 bg-white rounded">
        <div class="text-center mb-4">
            <span class="logo">🛡️ WAF Demo</span>
            <div class="text-muted">Web Application Firewall Demo</div>
        </div>
        <div class="mb-4">
            <h5>🔎 Input Threat Scanner</h5>
            <form method="post">
                {{ scanner_form.hidden_tag() }}
                <div class="input-group mb-2">
                    {{ scanner_form.scan_input(class_="form-control", placeholder="Paste or type any input to scan for threats") }}
                    {{ scanner_form.scan(class_="btn btn-success") }}
                </div>
            </form>
            {% if scan_result %}
                <div class="alert alert-{{ scan_color }} mt-2">{{ scan_result }}</div>
            {% endif %}
            <a href="/admin" class="btn btn-outline-primary btn-sm">View Security Events</a>
        </div>
        <hr>
        <div class="mb-4">
            <h5>📝 Submit Input (Normal Form)</h5>
            <form method="post">
                {{ form.hidden_tag() }}
                <div class="mb-3">
                    {{ form.input(class_="form-control", placeholder="Try SQLi, XSS, or any other attack") }}
                </div>
                {{ form.submit(class_="btn btn-primary w-100") }}
            </form>
        </div>
        {% if error %}
        <div class="alert alert-danger">{{ error }}</div>
        {% endif %}
        {% if message %}
        <div class="alert alert-success">{{ message }}</div>
        {% endif %}
        <hr>
        <div class="text-center">
            <small class="text-muted">© 2024 - WAF Project for Demo & Education</small>
        </div>
    </div>
</body>
</html>
    '''

if __name__ == "__main__":
    BLOCKED_IPS.clear()
    app.run(debug=True) 