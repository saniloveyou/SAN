# =============================================================================
# CAWW - CCTV-Firewall (MikroTik RouterOS 7.x example)
# Role: protects the CCTV network. WAN = ether1 (cable to WiFi-Firewall ether5),
#       LAN = bridge-cctv (cameras, NVR, PoE switch).
# Implements "Option A" (routed, NO NAT on this box) from
# docs/cctv-internet/README.md. For Option B (double NAT), uncomment the
# masquerade rule at the bottom.
# =============================================================================

# --- Interfaces / addressing -------------------------------------------------
/ip address add address=172.16.255.2/30 interface=ether1      comment="Transit to WiFi-FW"
/ip address add address=192.168.20.1/24 interface=bridge-cctv comment="CCTV LAN"

/ip route add dst-address=0.0.0.0/0 gateway=172.16.255.1 comment="Default via WiFi-FW"

# --- DHCP for cameras (use static leases per camera MAC) ----------------------
/ip pool add name=cctv-pool ranges=192.168.20.100-192.168.20.199
/ip dhcp-server network add address=192.168.20.0/24 gateway=192.168.20.1 \
    dns-server=192.168.20.1 ntp-server=192.168.20.1
/ip dhcp-server add name=dhcp-cctv interface=bridge-cctv address-pool=cctv-pool

# Firewall answers DNS and NTP for the cameras
/ip dns set allow-remote-requests=yes servers=9.9.9.9,149.112.112.112
/system ntp server set enabled=yes
/system ntp client set enabled=yes servers=pool.ntp.org

# --- Address lists ------------------------------------------------------------
/ip firewall address-list add list=RFC1918 address=10.0.0.0/8
/ip firewall address-list add list=RFC1918 address=172.16.0.0/12
/ip firewall address-list add list=RFC1918 address=192.168.0.0/16
/ip firewall address-list add list=NVR   address=192.168.20.10 comment="NVR/VMS"
/ip firewall address-list add list=ADMIN address=192.168.10.50 comment="Admin host on WiFi LAN"

# --- Filter rules --------------------------------------------------------------
/ip firewall filter
add chain=forward action=accept connection-state=established,related
add chain=forward action=drop connection-state=invalid

# Admin host (coming through the WiFi-Firewall) may reach the NVR
add chain=forward action=accept in-interface=ether1 src-address-list=ADMIN \
    dst-address-list=NVR protocol=tcp dst-port=443,554 \
    comment="Admin -> NVR web/RTSP"

# Only the NVR gets outbound Internet, HTTPS only
add chain=forward action=accept in-interface=bridge-cctv src-address-list=NVR \
    dst-address-list=!RFC1918 protocol=tcp dst-port=443 \
    comment="NVR -> vendor cloud / firmware updates"

# Cameras may never reach any private network beyond this firewall
add chain=forward action=drop in-interface=bridge-cctv dst-address-list=RFC1918 \
    comment="Block CCTV -> internal networks"

# Default deny: cameras get no direct Internet
add chain=forward action=drop log=yes log-prefix=CCTV-DROP

# Protect the firewall itself
add chain=input action=accept connection-state=established,related
add chain=input action=drop connection-state=invalid
add chain=input action=accept in-interface=bridge-cctv protocol=udp \
    dst-port=53,123 comment="DNS/NTP for cameras"
add chain=input action=accept in-interface=ether1 src-address-list=ADMIN \
    protocol=tcp dst-port=443 comment="Management GUI from admin host"
add chain=input action=accept protocol=icmp
add chain=input action=drop log=yes log-prefix=INPUT-DROP

# --- Option B only: enable double NAT -----------------------------------------
# /ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade \
#     comment="Option B: double NAT towards WiFi-Firewall"
