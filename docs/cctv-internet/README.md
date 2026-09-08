# CAWW — Connecting the CCTV network to the Internet (FortiGate)

Yes — this design assumes **both boxes are FortiGates** (FortiOS):

| Role | Device | Job |
|------|--------|-----|
| **WiFi-Firewall** | FortiGate (Internet edge) | Holds the ISP uplink, WiFi/user LAN, and a dedicated transit port toward the CCTV-Firewall |
| **CCTV-Firewall** | FortiGate (CCTV edge) | Protects cameras/NVR; its WAN plugs into the WiFi-Firewall transit port |

How it works: the CCTV-Firewall is chained **behind** the WiFi-Firewall. CCTV traffic goes  
`cameras/NVR → CCTV-Firewall → transit link → WiFi-Firewall → Internet`.  
The WiFi LAN and CCTV LAN stay isolated except for one admin host.

Ready-to-paste FortiOS CLI:

- [`wifi-firewall.conf`](wifi-firewall.conf) — WiFi-Firewall (edge)
- [`cctv-firewall.conf`](cctv-firewall.conf) — CCTV-Firewall

> Confirm on each unit: `get system status` (model + FortiOS). Interface names below (`wan1`, `lan`, `port3`, …) must match the physical ports on your hardware — rename if needed.

## 1. Target topology

```text
                Internet
                    |
              [ISP router/modem]
                    |  wan1
            +-------------------+
            |  WiFi-Firewall    |   FortiGate (edge)
            +-------------------+
        lan |               | port3 (CCTV_TRANSIT)
 192.168.10.1/24     172.16.255.1/30
            |               |
      WiFi / user       172.16.255.2/30  wan1
        network         +-------------------+
    192.168.10.0/24     |  CCTV-Firewall    |   FortiGate
                        +-------------------+
                                | lan 192.168.20.1/24
                                |
                          CCTV network
                        192.168.20.0/24
                 (cameras, NVR/VMS, PoE switch)
```

Key points:

- Plug the CCTV-Firewall **WAN into a dedicated FortiGate port** on the WiFi-Firewall (e.g. `port3`), **not** into the WiFi LAN switch/SSID. That dedicated port is its own zone so policies can isolate CCTV traffic.
- Cameras sit behind two FortiGates. Cross-access between WiFi and CCTV is denied unless explicitly allowed for the admin host.

## 2. Addressing plan

| Network            | Subnet             | Gateway / interface IP |
|--------------------|--------------------|------------------------|
| Internet uplink    | from ISP           | WiFi-Firewall `wan1` (DHCP or PPPoE) |
| WiFi / user LAN    | `192.168.10.0/24`  | WiFi-Firewall `lan` `192.168.10.1` |
| Transit link       | `172.16.255.0/30`  | WiFi-FW `port3` `172.16.255.1` ↔ CCTV-FW `wan1` `172.16.255.2` |
| CCTV network       | `192.168.20.0/24`  | CCTV-Firewall `lan` `192.168.20.1` |
| NVR (example)      | host               | `192.168.20.10` |
| Admin PC (example) | host               | `192.168.10.50` |

Adjust subnets/hosts if CAWW already uses different addressing. Keep the three roles: WiFi LAN, transit, CCTV LAN.

## 3. Routing and NAT — pick one option

### Option A — routed, single NAT (recommended)

- **CCTV-Firewall**: routing only, **no outbound NAT** on `wan1`. Default route → `172.16.255.1`.
- **WiFi-Firewall**: static route `192.168.20.0/24` via `172.16.255.2` on `port3`, and IP pool / SNAT on `wan1` so `192.168.20.0/24` (and transit) are translated to the public WAN IP.

Advantages: no double NAT, WiFi-Firewall logs show real CCTV source IPs, SSL-VPN / IPsec to the NVR is simpler.

### Option B — double NAT (simplest)

- **CCTV-Firewall**: enable SNAT/masquerade on `wan1` toward `172.16.255.1`.
- **WiFi-Firewall**: no static route to `192.168.20.0/24` required — it only sees `172.16.255.2`.

Use Option B only if you cannot add a static route on the WiFi-Firewall. Downside: all CCTV traffic looks like one IP, and inbound reachability needs DNAT on both boxes (avoid that — use VPN instead).

The provided `.conf` files implement **Option A**. Option B notes are commented at the bottom of `cctv-firewall.conf`.

## 4. Firewall policy (least privilege)

Cameras are a common attack vector. Give the CCTV zone Internet access **only** for what is required.

### CCTV-Firewall policies

| # | From → To | Source | Destination | Service | Action | Purpose |
|---|-----------|--------|-------------|---------|--------|---------|
| 1 | lan → wan1 | NVR `192.168.20.10` | all (Internet) | HTTPS | Accept | Firmware / vendor cloud |
| 2 | lan → wan1 | CCTV LAN | RFC1918 | ALL | Deny | No path to WiFi/transit/other private nets |
| 3 | lan → wan1 | CCTV LAN | all | ALL | Deny (log) | Cameras get **no** direct Internet |
| 4 | wan1 → lan | Admin `192.168.10.50` | NVR | HTTPS, RTSP | Accept | Admin view/manage NVR |
| 5 | wan1 → (local) | Admin | this FortiGate | HTTPS | Accept | Manage CCTV-Firewall GUI/API |

DNS/NTP for cameras: enable FortiGate DNS service / NTP on the CCTV LAN interface (or allow UDP 53/123 to the firewall itself).

### WiFi-Firewall policies

| # | From → To | Source | Destination | Service | Action | Purpose |
|---|-----------|--------|-------------|---------|--------|---------|
| 1 | CCTV_TRANSIT → lan | any | WiFi LAN | ALL | Deny | CCTV never reaches user devices |
| 2 | CCTV_TRANSIT → wan1 | CCTV nets | all | HTTP, HTTPS, DNS, NTP | Accept | Allowed Internet egress |
| 3 | CCTV_TRANSIT → wan1 | any | all | ALL | Deny (log) | Default deny from transit |
| 4 | lan → CCTV_TRANSIT | Admin host | CCTV zone | HTTPS, RTSP | Accept | Only admin enters CCTV |
| 5 | lan → CCTV_TRANSIT | WiFi LAN | CCTV zone | ALL | Deny | Everyone else stays out |

## 5. FortiGate GUI checklist

**WiFi-Firewall**

1. *Network → Interfaces*: configure spare port (e.g. `port3`) as `CCTV_TRANSIT`, address `172.16.255.1/30`, role LAN/undefined, no DHCP server. Create or reuse address objects for WiFi LAN, CCTV net, admin host, NVR.
2. *Network → Static Routes* (Option A): `192.168.20.0/24` → gateway `172.16.255.2`, device `port3`.
3. *Policy & Objects → Firewall Policy*: add the WiFi-Firewall rows from §4. Put deny-to-LAN **above** allow-to-Internet.
4. *Policy & Objects → NAT* / policy SNAT: ensure `wan1` outbound SNAT covers `192.168.20.0/24` (and transit if needed). On many FortiGates, enabling NAT on the WAN-bound policy is enough.
5. Optional: *VPN → SSL-VPN* (or IPsec) for remote NVR access — do **not** DNAT cameras from the Internet.

**CCTV-Firewall**

1. *Network → Interfaces*: `wan1` = `172.16.255.2/30`, gateway `172.16.255.1`. Disable “block private / bogon addresses” on this WAN if present (upstream is private).
2. `lan` = `192.168.20.1/24`; enable DHCP if cameras use DHCP (prefer reserved leases per MAC).
3. Option A: do **not** enable NAT on policies toward `wan1`. Option B: enable NAT on the NVR→Internet policy.
4. *Policy & Objects → Firewall Policy*: replace any default lan→wan allow-all with the CCTV-Firewall rows from §4.
5. *System → Settings* / *Network → DNS* / *System → NTP*: DNS and NTP reachable from the CCTV LAN.

Or paste the CLI files over SSH (`config` … `end`) after editing interface names and object IPs.

## 6. Remote viewing — do not port-forward cameras

If CAWW needs off-site viewing:

- Prefer **SSL-VPN or IPsec on the WiFi-Firewall**, then policy VPN → NVR (`192.168.20.10`) only, or
- Use the NVR vendor’s **outbound** cloud relay (covered by CCTV HTTPS allow for the NVR only).

Do not open VIP/DNAT from the public Internet to cameras or the NVR.

## 7. Validation checklist

- [ ] From the NVR: ping `172.16.255.1`; resolve DNS; HTTPS to the Internet works.
- [ ] From a camera: NTP/DNS OK; direct HTTP/HTTPS to Internet is **blocked**.
- [ ] From NVR: ping `192.168.10.1` / WiFi hosts → **blocked**.
- [ ] From a normal WiFi client: ping `192.168.20.10` → **blocked**.
- [ ] From admin `192.168.10.50`: CCTV-FW GUI `https://172.16.255.2` and NVR `https://192.168.20.10` → **work**.
- [ ] External scan of the public WAN IP shows no new camera/NVR ports.

## 8. Related earlier draft

An earlier draft used MikroTik/pfSense-oriented examples (`cursor/cctv-internet-firewall-config-9e60`). This document replaces that vendor assumption with **FortiGate / FortiOS**, which matches CAWW’s planned hardware.
