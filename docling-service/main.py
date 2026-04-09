"""
Docling service — JSON-line protocol over stdin/stdout.

Request:  {"id": "<uuid>", "file_path": "<path>", "options": {...}}
Response: {"id": "<uuid>", "status": "ok", "data": {...}}
       or {"id": "<uuid>", "status": "error", "error": "<msg>"}
"""

import sys
import json
import asyncio
from parser import parse_document


async def handle_request(line: str) -> None:
    try:
        req = json.loads(line)
    except json.JSONDecodeError as e:
        print(json.dumps({"id": None, "status": "error", "error": f"Invalid JSON: {e}"}), flush=True)
        return

    req_id = req.get("id")
    try:
        result = await parse_document(req["file_path"], req.get("options", {}))
        print(json.dumps({"id": req_id, "status": "ok", "data": result}), flush=True)
    except Exception as e:
        print(json.dumps({"id": req_id, "status": "error", "error": str(e)}), flush=True)


async def main() -> None:
    loop = asyncio.get_event_loop()
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await loop.connect_read_pipe(lambda: protocol, sys.stdin)

    print(json.dumps({"status": "ready"}), flush=True)

    while True:
        line_bytes = await reader.readline()
        if not line_bytes:
            break
        line = line_bytes.decode().strip()
        if line:
            asyncio.create_task(handle_request(line))


if __name__ == "__main__":
    asyncio.run(main())
