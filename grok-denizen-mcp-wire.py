#!/usr/bin/env python3
"""
Wire Grok for real autonomy with Denizen MCP (grok NPC).

This uses the native xAI / OpenAI-compatible Responses API MCP support.
Grok will autonomously decide when to call tools like announce_in_office, run_skill, etc.
Actions will be visible in the Denizen office.

Usage:
    python grok-denizen-mcp-wire.py "Your goal here, e.g. research something and announce progress"

Requires: openai package (pip install openai)
"""

import os
import sys
from openai import OpenAI

# === CONFIG - REAL VALUES (from .mcp-token.local.json) ===
XAI_API_KEY = os.environ.get("XAI_API_KEY") or "xai-YOUR_KEY_HERE"   # set your xAI key
MCP_SERVER_URL = "https://denizen.dolonia.cloud/mcp/npc/grok"
MCP_AUTH = "Bearer 1tSUl6b55JgnKW4FrJBN9GEbV3DT2L9MNR2bwDhAEC0"
MCP_LABEL = "denizen-grok"

def main():
    if len(sys.argv) < 2:
        print("Usage: python grok-denizen-mcp-wire.py \"Your autonomous goal for Grok in the office\"")
        print("Example: python grok-denizen-mcp-wire.py \"Announce that I'm online, then run a research skill on Denizen MCP integration and report back visibly.\"")
        sys.exit(1)

    goal = " ".join(sys.argv[1:])

    client = OpenAI(
        api_key=XAI_API_KEY,
        base_url="https://api.x.ai/v1"
    )

    print(f"Connecting Grok to Denizen MCP for autonomy...")
    print(f"Goal: {goal}\n")

    resp = client.responses.create(
        model="grok-4.3",
        input=[{
            "role": "user",
            "content": goal
        }],
        tools=[{
            "type": "mcp",
            "server_url": MCP_SERVER_URL,
            "server_label": MCP_LABEL,
            "authorization": MCP_AUTH,
            # allowed_tools omitted = full autonomy over all available tools
        }]
    )

    print("=== Grok Response ===")
    print(resp)

    # If tool calls happened, they executed on Denizen side (visible in office)
    if hasattr(resp, 'tool_calls') and resp.tool_calls:
        print("\n=== Tool calls executed autonomously ===")
        for tc in resp.tool_calls:
            print(tc)

if __name__ == "__main__":
    main()
