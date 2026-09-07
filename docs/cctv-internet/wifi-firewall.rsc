# =============================================================================
# CAWW - WiFi-Firewall (MikroTik RouterOS 7.x example)
# Role: Internet edge. WAN = ether1 (ISP), LAN = bridge-lan (WiFi/user network),
#       ether5 = dedicated transit port to the CCTV-Firewall.
# Implements "Option A" (routed, single NAT) from docs/cctv-internet/README.md
# =============================================================================

# --- Interfaces / addressing -------------------------------------------------
/interface list add name=WAN
/interface list add name=LAN
/interface list member add interface=ether1 list=WAN
/interface list member add interface=bridge-lan list=LAN

/ip address add address=192.168.10.1/24 interface=bridge-lan comment="WiFi LAN"
/ip address add address=172.16.255.1/30 interface=ether5    comment="Transit to CCTV-FW"

# --- Route to the CCTV network (Option A) ------------------------------------
/ip route add dst-address=192.168.20.0/24 gateway=172.16.255.2 \
    comment="CCTV network behind CCTV-Firewall"

# --- Address lists ------------------------------------------------------------
/ip firewall address-list add list=CCTV_NETS address=192.168.20.0/24
/ip firewall address-list add list=CCTV_NETS address=172.16.255.0/30
/ip firewall address-list add list=WIFI_LAN  address=192.168.10.0/24
/ip firewall address-list add list=ADMIN     address=192.168.10.50 \
    comment="Admin workstation allowed into the CCTV zone"

# --- NAT: single NAT at the edge for LAN + CCTV nets --------------------------
/ip firewall nat add chain=srcnat out-interface-list=WAN \
    src-address=192.168.10.0/24 action=masquerade comment="WiFi LAN -> Internet"
/ip firewall nat add chain=srcnat out-interface-list=WAN \
    src-address-list=CCTV_NETS action=masquerade comment="CCTV nets -> Internet"

# --- Filter rules --------------------------------------------------------------
/ip firewall filter
add chain=forward action=accept connection-state=established,related \
    comment="Fast-path established/related"
add chain=forward action=drop connection-state=invalid

# CCTV side may never reach the WiFi LAN
add chain=forward action=drop in-interface=ether5 dst-address-list=WIFI_LAN \
    comment="Block CCTV zone -> WiFi LAN"

# Only the admin host may enter the CCTV zone from the WiFi LAN
add chain=forward action=accept in-interface=bridge-lan out-interface=ether5 \
    src-address-list=ADMIN comment="Admin host -> CCTV zone"
add chain=forward action=drop in-interface=bridge-lan out-interface=ether5 \
    comment="Everyone else on WiFi LAN stays out of CCTV zone"

# CCTV zone -> Internet, restricted to what the CCTV-FW already permits
add chain=forward action=accept in-interface=ether5 out-interface-list=WAN \
    src-address-list=CCTV_NETS protocol=tcp dst-port=80,443 \
    comment="CCTV zone -> web (updates/cloud)"
add chain=forward action=accept in-interface=ether5 out-interface-list=WAN \
    src-address-list=CCTV_NETS protocol=udp dst-port=53,123 \
    comment="CCTV zone -> DNS/NTP"
add chain=forward action=drop in-interface=ether5 log=yes log-prefix=CCTV-DROP \
    comment="Default deny from CCTV zone"

# WiFi LAN -> Internet
add chain=forward action=accept in-interface=bridge-lan out-interface-list=WAN

# Default deny for anything else forwarded
add chain=forward action=drop log=yes log-prefix=FWD-DROP

# Protect the firewall itself
add chain=input action=accept connection-state=established,related
add chain=input action=drop connection-state=invalid
add chain=input action=accept in-interface=bridge-lan src-address-list=ADMIN \
    comment="Management from admin host only"
add chain=input action=accept protocol=udp dst-port=53,123 \
    in-interface=bridge-lan comment="DNS/NTP for WiFi LAN clients"
add chain=input action=accept protocol=icmp
add chain=input action=drop log=yes log-prefix=INPUT-DROP
