from datetime import datetime

def log_attack(ip, attack_type, payload, user_agent="", url=""):
    with open("attacks.log", "a") as file:
        file.write(f"[{datetime.now()}] IP: {ip} | Type: {attack_type} | Payload: {payload} | UA: {user_agent} | URL: {url}\n") 