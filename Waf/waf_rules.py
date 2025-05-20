import re

# أنماط لكشف هجمات SQLi و XSS
SQLI_PATTERNS = [
    r"(?i)(union\s+select)",
    r"(?i)or\s+1=1",
    r"'--",
    r"(?i)'\s*or\s*'1'\s*=\s*'1",  # أكثر مرونة
    r"(?i)or\s+['\"]?\d+['\"]?=\d+",  # أرقام
    r"(?i)or\s+true",  # true
    r"(?i)or\s+1=1--",
    r"(?i)select\s+.*from",
    r"(?i)insert\s+into",
    r"(?i)drop\s+table",
    r"(?i)update\s+.*set",
    r"(?i)delete\s+from"
]

XSS_PATTERNS = [
    r"(?i)<script.*?>.*?</script>",
    r"(?i)onerror\s*=",
    r"alert\s*\(",
    r"(?i)onload\s*=",
    r"(?i)<img.*?src.*?=",
    r"(?i)<iframe.*?>",
    r"(?i)<svg.*?on.*?=",
    r"(?i)document\.cookie"
]

LFI_PATTERNS = [
    r"\.\./",
    r"/etc/passwd",
    r"/proc/self/environ",
    r"c:\\windows\\win.ini"
]

RFI_PATTERNS = [
    r"http[s]?://[\w\.-]+/.*",
    r"ftp://[\w\.-]+/.*"
]

CMD_INJECTION_PATTERNS = [
    r";\s*cat ",
    r";\s*ls ",
    r";\s*whoami",
    r"\|\s*ls",
    r"&&\s*ls",
    r"\|\|",
    r";\s*echo "
]

PATH_TRAVERSAL_PATTERNS = [
    r"\.\./",
    r"\.\.\\",
    r"/\.\./",
    r"\\\.\.\\"
]

def is_malicious(payload: str) -> str:
    for pattern in SQLI_PATTERNS:
        if re.search(pattern, payload):
            return "SQLi"
    for pattern in XSS_PATTERNS:
        if re.search(pattern, payload):
            return "XSS"
    return None

def is_lfi(payload: str) -> bool:
    for pattern in LFI_PATTERNS:
        if re.search(pattern, payload, re.IGNORECASE):
            return True
    return False

def is_rfi(payload: str) -> bool:
    for pattern in RFI_PATTERNS:
        if re.search(pattern, payload, re.IGNORECASE):
            return True
    return False

def is_cmd_injection(payload: str) -> bool:
    for pattern in CMD_INJECTION_PATTERNS:
        if re.search(pattern, payload, re.IGNORECASE):
            return True
    return False

def is_path_traversal(payload: str) -> bool:
    for pattern in PATH_TRAVERSAL_PATTERNS:
        if re.search(pattern, payload, re.IGNORECASE):
            return True
    return False 