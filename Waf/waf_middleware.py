from flask import request, abort
from waf_rules import is_malicious, is_lfi, is_rfi, is_cmd_injection, is_path_traversal
from attack_logger import log_attack
import time

# Simple in-memory IP blocklist and attack counter (for demo)
IP_ATTACKS = {}
BLOCKED_IPS = {}
BLOCK_DURATION = 10 * 60  # 10 minutes in seconds
MAX_ATTEMPTS = 3


def waf():
    ip = request.remote_addr
    now = time.time()

    # Check if IP is blocked
    if ip in BLOCKED_IPS:
        # Unblock if block duration expired
        if now - BLOCKED_IPS[ip] > BLOCK_DURATION:
            del BLOCKED_IPS[ip]
            IP_ATTACKS.pop(ip, None)
        else:
            return abort(403, "Your IP is temporarily blocked due to repeated attacks.")

    payload = ""

    # جمع كل البيانات من POST و GET
    if request.args:
        payload += " ".join(request.args.values())
    if request.form:
        payload += " ".join(request.form.values())

    # أنواع الهجمات
    attack_type = is_malicious(payload)
    if not attack_type:
        if is_lfi(payload):
            attack_type = "LFI"
        elif is_rfi(payload):
            attack_type = "RFI"
        elif is_cmd_injection(payload):
            attack_type = "CMD Injection"
        elif is_path_traversal(payload):
            attack_type = "Path Traversal"

    if attack_type:
        log_attack(
            ip,
            attack_type,
            payload,
            request.headers.get('User-Agent', ''),
            request.url
        )
        # Count attacks per IP
        attacks = IP_ATTACKS.get(ip, [])
        # Remove old attacks
        attacks = [t for t in attacks if now - t < BLOCK_DURATION]
        attacks.append(now)
        IP_ATTACKS[ip] = attacks
        if len(attacks) >= MAX_ATTEMPTS:
            BLOCKED_IPS[ip] = now
            return abort(403, "Your IP is temporarily blocked due to repeated attacks.")
        return abort(403, f"Blocked by WAF: Detected {attack_type}") 