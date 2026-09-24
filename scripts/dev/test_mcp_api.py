import asyncio
import json
import os
import sys
import urllib.request

async def main():
    email = os.environ.get("WAI_ADMIN_EMAIL", "admin@wai.local")
    password = os.environ.get("WAI_ADMIN_PASSWORD", "")
    if not password:
        sys.exit("set WAI_ADMIN_PASSWORD (and optionally WAI_ADMIN_EMAIL) to run this script")
    req = urllib.request.Request(
        "http://127.0.0.1:8090/api/v1/auth/login",
        data=json.dumps({"email": email, "password": password}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    token = json.loads(urllib.request.urlopen(req, timeout=5).read())["token"]
    headers = {"Authorization": f"Bearer {token}"}

    me = json.loads(
        urllib.request.urlopen(
            urllib.request.Request("http://127.0.0.1:8090/api/v1/me", headers=headers), timeout=5
        ).read()
    )
    org_id = me["org_id"]
    for path in ["/api/v1/mcp-servers/health", f"/api/v1/orgs/{org_id}/mcp-servers"]:
        body = urllib.request.urlopen(
            urllib.request.Request(f"http://127.0.0.1:8090{path}", headers=headers), timeout=5
        ).read()
        print(path, body.decode()[:400])

asyncio.run(main())
