# CAWW — Connecting the CCTV network to the Internet

CAWW wants the CCTV network to reach the Internet. The chosen approach is to
chain the **CCTV-Firewall** behind the **WiFi-Firewall**, so all CCTV traffic
leaves through the existing Internet uplink while the CCTV network stays
isolated from the WiFi/user network.

## 1. Target topology

```text
                Internet
                    |
              [ISP router/modem]
                    |  WAN (DHCP or PPPoE from ISP)
            +-------------------+
            |   WiFi-Firewall   |
            +-------------------+
        LAN |               | OPT1 / transit
 192.168.10.1/24     172.16.255.1/30
            |               |
      WiFi / user       172.16.255.2/30  WAN
        network         +-------------------+
    192.168.10.0/24     |   CCTV-Firewall   |
                        +-------------------+
                                | LAN 192.168.20.1/24
                                |
                          CCTV network
                        192.168.20.0/24
                 (cameras, NVR/VMS, PoE switch)
```

Key points of this design:

- The CCTV-Firewall's **WAN port plugs into a dedicated port (OPT1)** on the
  WiFi-Firewall, using a small point-to-point *transit network*
  (`172.16.255.0/30`). Do **not** plug it into the WiFi LAN switch/SSID —
  a dedicated port lets the WiFi-Firewall filter CCTV traffic separately.
- CCTV devices are double-protected: they sit behind two firewalls, and the
  WiFi network can never be reached from the cameras (and vice versa) unless
  explicitly allowed.

## 2. Addressing plan

| Network            | Subnet             | Gateway / interface IP            |
|--------------------|--------------------|-----------------------------------|
| Internet uplink    | from ISP           | WiFi-Firewall WAN (DHCP/PPPoE)    |
| WiFi / user LAN    | `192.168.10.0/24`  | WiFi-Firewall LAN `192.168.10.1`  |
| Transit link       | `172.16.255.0/30`  | WiFi-FW `172.16.255.1` ↔ CCTV-FW `172.16.255.2` |
| CCTV network       | `192.168.20.0/24`  | CCTV-Firewall LAN `192.168.20.1`  |

Adjust the subnets if they collide with what CAWW already uses — the rules
below only need the same three "roles" (WiFi LAN, transit, CCTV LAN).

## 3. Routing and NAT — pick one option

### Option A — routed, single NAT (recommended)

- **CCTV-Firewall**: routes only, **NAT disabled**. Default route → `172.16.255.1`.
- **WiFi-Firewall**: static route `192.168.20.0/24 via 172.16.255.2`, and its
  outbound NAT on WAN must also translate `192.168.20.0/24` (and the transit
  subnet) to the WAN IP.

Advantages: no double NAT, the WiFi-Firewall sees real camera IPs in its logs,
and VPN access to cameras (see §6) works without extra port forwards.

### Option B — double NAT (simplest, no route changes on the WiFi-Firewall)

- **CCTV-Firewall**: NAT (masquerade) enabled on its WAN, default route →
  `172.16.255.1`.
- **WiFi-Firewall**: nothing special — it just sees one host (`172.16.255.2`)
  behind OPT1 and NATs it out like any client.

Use this if you cannot add static routes on the WiFi-Firewall. Downside:
everything from the CCTV network appears as a single IP, and reaching cameras
from outside requires port forwarding on *both* firewalls.

## 4. Firewall policy

Cameras are a common attack vector and are frequently compromised to join
botnets, so **the CCTV network gets Internet access on a least-privilege
basis** — not a blanket allow.

### CCTV-Firewall rules (LAN-in, i.e. traffic from cameras/NVR)

| # | Action | Source              | Destination            | Ports              | Purpose |
|---|--------|---------------------|------------------------|--------------------|---------|
| 1 | Allow  | CCTV LAN            | CCTV-FW LAN IP         | UDP 53, 123        | DNS + NTP served/relayed by the firewall |
| 2 | Allow  | NVR (`192.168.20.10`) | any (Internet)       | TCP 443            | Firmware updates / vendor cloud (P2P view) |
| 3 | Block  | CCTV LAN            | RFC1918 (`10/8`, `172.16/12`, `192.168/16`) | any | Cameras can never reach the WiFi LAN, transit, or other internal nets |
| 4 | Block (log) | CCTV LAN       | any                    | any                | Default deny — cameras themselves get **no** direct Internet |

> If cameras (not just the NVR) genuinely need vendor-cloud access, add an
> allow rule per camera/destination above rule 3 rather than opening the whole
> subnet.

### CCTV-Firewall rules (WAN-in, i.e. traffic from the WiFi side)

| # | Action | Source                        | Destination     | Ports          | Purpose |
|---|--------|-------------------------------|-----------------|----------------|---------|
| 1 | Allow  | Admin host `192.168.10.50`    | CCTV-FW WAN IP  | TCP 443 (GUI)  | Manage the CCTV-Firewall from the WiFi LAN |
| 2 | Allow  | Admin host `192.168.10.50`    | NVR `192.168.20.10` | TCP 443/554 | View/manage the NVR (Option A only) |
| 3 | Block  | any                           | any             | any            | Default deny |

### WiFi-Firewall rules (OPT1/transit-in, i.e. traffic coming from the CCTV side)

| # | Action | Source            | Destination        | Ports    | Purpose |
|---|--------|-------------------|--------------------|----------|---------|
| 1 | Block  | any               | WiFi LAN `192.168.10.0/24` | any | CCTV side can never reach user devices |
| 2 | Block  | any               | WiFi-FW itself (except DNS/NTP if it serves them) | any | Protect the firewall |
| 3 | Allow  | `192.168.20.0/24` + `172.16.255.0/30` | any (Internet) | TCP 80/443, UDP 53/123 | Internet access for the flows permitted by the CCTV-FW |
| 4 | Block (log) | any          | any                | any      | Default deny |

### WiFi-Firewall rules (LAN-in additions)

| # | Action | Source                     | Destination                         | Purpose |
|---|--------|----------------------------|-------------------------------------|---------|
| 1 | Allow  | Admin host `192.168.10.50` | `172.16.255.2`, `192.168.20.0/24`  | Only the admin workstation may enter the CCTV zone |
| 2 | Block  | WiFi LAN                   | `172.16.255.0/30`, `192.168.20.0/24` | Everyone else stays out |

## 5. Step-by-step (pfSense / OPNsense style)

**On the WiFi-Firewall:**

1. *Interfaces → Assignments*: assign the spare port as **OPT1**
   (rename it `CCTV_TRANSIT`), static IPv4 `172.16.255.1/30`. No DHCP server.
2. *System → Routing → Static Routes* (Option A only): add
   `192.168.20.0/24` via gateway `172.16.255.2` (create the gateway entry on
   OPT1 first).
3. *Firewall → NAT → Outbound* (Option A only): switch to *Hybrid* mode and add
   a rule translating source `192.168.20.0/24` (and `172.16.255.0/30`) on WAN.
4. *Firewall → Rules → CCTV_TRANSIT*: create the rules from §4 in that order
   (block-to-LAN first, then allow-to-Internet, default deny is implicit).
5. *Firewall → Rules → LAN*: add the admin-host allow + CCTV block pair.

**On the CCTV-Firewall:**

1. WAN interface: static IPv4 `172.16.255.2/30`, gateway `172.16.255.1`.
   **Untick** "Block private networks" on WAN (the upstream *is* a private
   network).
2. LAN interface: `192.168.20.1/24`. Enable the DHCP server if cameras use
   DHCP (recommended: DHCP static mappings per camera MAC).
3. Option A: *Firewall → NAT → Outbound* → mode **Disable**.
   Option B: leave outbound NAT on Automatic.
4. *Firewall → Rules → LAN*: replace the default "allow all" with the LAN
   rules from §4.
5. *Firewall → Rules → WAN*: add the admin-host management allows.
6. *Services → NTP / DNS*: enable so cameras sync time and resolve through the
   firewall (matches LAN rule 1).

Equivalent ready-to-paste configs for MikroTik RouterOS are provided in
[`wifi-firewall.rsc`](wifi-firewall.rsc) and
[`cctv-firewall.rsc`](cctv-firewall.rsc).

## 6. Remote viewing — do NOT port-forward cameras

If CAWW wants to watch cameras from outside, **do not forward ports** from the
Internet to the NVR/cameras (exposed CCTV gear is scanned and exploited within
hours). Instead either:

- run **WireGuard/OpenVPN on the WiFi-Firewall** and allow VPN clients →
  `192.168.20.10` (NVR) only, or
- use the NVR vendor's outbound cloud relay (covered by CCTV LAN rule 2 —
  outbound TCP 443 only, no inbound holes).

## 7. Validation checklist

Run these after wiring everything up:

- [ ] From the NVR: `ping 172.16.255.1` (transit up), `nslookup example.com`
      (DNS via CCTV-FW), `curl https://example.com` (Internet OK).
- [ ] From a camera: NTP syncs; HTTP/HTTPS to the Internet is **blocked**
      (unless explicitly allowed).
- [ ] From the NVR: `ping 192.168.10.1` and any WiFi-LAN host → **blocked**.
- [ ] From a normal WiFi client: `ping 192.168.20.10` → **blocked**.
- [ ] From the admin host `192.168.10.50`: CCTV-FW GUI at
      `https://172.16.255.2` and NVR at `https://192.168.20.10` → **works**.
- [ ] External port scan of the WAN IP shows no new open ports.
