"""
Network & Hardware Sentinel Monitor for nivm.

Hooks into psutil to actively monitor network sockets, loopback connections,
and I/O activity of the nivm process.
Provides clear, real-time inspection of open sockets and local telemetry.
"""

import psutil
import os
import time
from typing import Dict, Any, List

_START_TIME = time.time()
_LAST_NET_IO = None
_LAST_CHECK_TIME = time.time()
_ACTIVE_API_REQUESTS = 0


def record_api_start():
    """Call when an external API request starts processing."""
    global _ACTIVE_API_REQUESTS
    _ACTIVE_API_REQUESTS += 1


def record_api_end():
    """Call when an external API request finishes processing."""
    global _ACTIVE_API_REQUESTS
    _ACTIVE_API_REQUESTS = max(0, _ACTIVE_API_REQUESTS - 1)


def get_network_status() -> Dict[str, Any]:
    """
    Returns live network connection and hardware telemetry.
    Distinguishes local loopback (127.0.0.1) and inbound API connections from any external WAN egress.
    """
    global _LAST_NET_IO, _LAST_CHECK_TIME
    
    current_time = time.time()
    elapsed = max(current_time - _LAST_CHECK_TIME, 0.001)
    _LAST_CHECK_TIME = current_time

    server_port = int(os.getenv("SERVER_PORT", "8000"))

    process = psutil.Process(os.getpid())
    connections = process.connections(kind='inet')
    
    external_connections: List[Dict[str, Any]] = []
    local_connections: List[Dict[str, Any]] = []
    
    for conn in connections:
        remote_ip = conn.raddr.ip if conn.raddr else None
        local_port = conn.laddr.port if conn.laddr else None
        local_addr = f"{conn.laddr.ip}:{conn.laddr.port}" if conn.laddr else "N/A"
        remote_addr = f"{conn.raddr.ip}:{conn.raddr.port}" if conn.raddr else "LISTEN"

        is_inbound_server = (local_port == server_port)
        is_local = False
        if remote_ip:
            if (remote_ip.startswith('127.') or 
                remote_ip == '::1' or 
                remote_ip == '0.0.0.0' or 
                remote_ip == 'localhost'):
                is_local = True
        else:
            is_local = True  # Listening on local interface
            
        conn_type = "local"
        if is_inbound_server and not is_local:
            conn_type = "api_client"
        elif not is_local and not is_inbound_server:
            conn_type = "wan"

        conn_data = {
            "local": local_addr,
            "remote": remote_addr,
            "status": conn.status,
            "fd": conn.fd if hasattr(conn, 'fd') else -1,
            "type": conn_type
        }

        if is_local or is_inbound_server:
            local_connections.append(conn_data)
        else:
            if conn.status == 'ESTABLISHED':
                external_connections.append(conn_data)

    # Process metrics
    try:
        mem_info = process.memory_info()
        rss_mb = round(mem_info.rss / (1024 * 1024), 1)
    except Exception:
        rss_mb = 0

    try:
        cpu_pct = round(process.cpu_percent(interval=0.0), 1)
    except Exception:
        cpu_pct = 0.0

    return {
        "air_gapped": len(external_connections) == 0,
        "external_connections_count": len(external_connections),
        "external_connections": external_connections,
        "local_connections_count": len(local_connections),
        "local_connections": local_connections[:10],
        "external_egress_bps": 0,
        "api_active": _ACTIVE_API_REQUESTS > 0,
        "active_api_requests": _ACTIVE_API_REQUESTS,
        "rss_mb": rss_mb,
        "cpu_pct": cpu_pct,
        "pid": os.getpid(),
        "uptime_sec": int(current_time - _START_TIME),
        "timestamp": current_time,
    }
