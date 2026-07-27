#!/bin/bash

# WG Panel Installation Script
# One-command installer for wg-panel on a clean VPS

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     WG Panel Installation Script       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}Please run as root (sudo ./install.sh)${NC}"
    exit 1
fi

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$NAME
else
    echo -e "${RED}Cannot detect OS${NC}"
    exit 1
fi

echo -e "${GREEN}Detected OS: ${OS}${NC}"
echo ""

# Install system dependencies
echo -e "${YELLOW}Installing system dependencies...${NC}"

case $OS in
    *"Ubuntu"*|*"Debian"*)
        apt-get update
        apt-get install -y nodejs npm git curl wget ufw
        ;;
    *"CentOS"*|*"Rocky"*|*"AlmaLinux"*)
        yum install -y nodejs npm git curl wget ufw firewalld
        ;;
    *)
        echo -e "${RED}Unsupported OS: $OS${NC}"
        exit 1
        ;;
esac

echo -e "${GREEN}✓ System dependencies installed${NC}"
echo ""

# Check if Docker is installed (for wg-easy)
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Docker not found. Would you like to install Docker for wg-easy? (y/n)${NC}"
    read -r install_docker
    
    if [ "$install_docker" = "y" ] || [ "$install_docker" = "Y" ]; then
        echo -e "${YELLOW}Installing Docker...${NC}"
        curl -fsSL https://get.docker.com -o get-docker.sh
        sh get-docker.sh
        rm get-docker.sh
        systemctl enable docker
        systemctl start docker
        echo -e "${GREEN}✓ Docker installed${NC}"
    fi
else
    echo -e "${GREEN}✓ Docker already installed${NC}"
fi
echo ""

# Check if wg-easy is running
WG_EASY_RUNNING=false
if command -v docker &> /dev/null; then
    if docker ps | grep -q wg-easy; then
        WG_EASY_RUNNING=true
        echo -e "${GREEN}✓ wg-easy is already running${NC}"
    fi
fi

if [ "$WG_EASY_RUNNING" = false ]; then
    echo -e "${YELLOW}wg-easy is not running. Would you like to install it? (y/n)${NC}"
    read -r install_wgeasy
    
    if [ "$install_wgeasy" = "y" ] || [ "$install_wgeasy" = "Y" ]; then
        echo -e "${YELLOW}Installing wg-easy...${NC}"
        
        # Create wg-easy directory
        mkdir -p /opt/wg-easy
        cd /opt/wg-easy
        
        # Create docker-compose.yml
        cat > docker-compose.yml << 'EOF'
version: "3.8"
services:
  wg-easy:
    image: ghcr.io/wg-easy/wg-easy:15
    container_name: wg-easy
    volumes:
      - .:/etc/wireguard
    ports:
      - "51820:51820/udp"
      - "51821:51821/tcp"
    environment:
      - WG_HOST=<YOUR_SERVER_IP>
      - PASSWORD=<YOUR_PASSWORD>
      - USERNAME=admin
    cap_add:
      - NET_ADMIN
      - SYS_MODULE
    sysctls:
      - net.ipv4.ip_forward=1
      - net.ipv4.conf.all.src_valid_mark=1
    restart: unless-stopped
EOF
        
        echo -e "${YELLOW}Enter your server's public IP address:${NC}"
        read -r server_ip
        echo -e "${YELLOW}Enter admin password for wg-easy:${NC}"
        read -r wg_password
        
        # Update docker-compose with actual values
        sed -i "s/<YOUR_SERVER_IP>/$server_ip/g" docker-compose.yml
        sed -i "s/<YOUR_PASSWORD>/$wg_password/g" docker-compose.yml
        
        docker compose up -d
        echo -e "${GREEN}✓ wg-easy installed and running${NC}"
        
        # Save credentials for later
        WG_EASY_URL="http://localhost:51821"
        WG_EASY_USERNAME="admin"
        WG_EASY_PASSWORD="$wg_password"
    else
        echo -e "${YELLOW}Skipping wg-easy installation${NC}"
        echo -e "${YELLOW}Enter wg-easy URL (default: http://localhost:51821):${NC}"
        read -r wg_url
        WG_EASY_URL=${wg_url:-http://localhost:51821}
        
        echo -e "${YELLOW}Enter wg-easy username:${NC}"
        read -r wg_username
        WG_EASY_USERNAME=${wg_username:-admin}
        
        echo -e "${YELLOW}Enter wg-easy password:${NC}"
        read -r wg_password
        WG_EASY_PASSWORD=$wg_password
    fi
else
    WG_EASY_URL="http://localhost:51821"
    echo -e "${YELLOW}Enter wg-easy username (default: admin):${NC}"
    read -r wg_username
    WG_EASY_USERNAME=${wg_username:-admin}
    
    echo -e "${YELLOW}Enter wg-easy password:${NC}"
    read -r wg_password
    WG_EASY_PASSWORD=$wg_password
fi
echo ""

# Get Telegram bot info
echo -e "${YELLOW}=== Telegram Bot Configuration ===${NC}"
echo -e "${YELLOW}Create a bot via @BotFather in Telegram and enter the token:${NC}"
read -r bot_token
TELEGRAM_BOT_TOKEN=$bot_token

echo -e "${YELLOW}Enter your Telegram ID (use @userinfobot to find it):${NC}"
read -r admin_id
TELEGRAM_ADMIN_ID=$admin_id

echo -e "${YELLOW}Enter bot username (without @):${NC}"
read -r bot_username
TELEGRAM_BOT_USERNAME=$bot_username
echo ""

# Install wg-panel
echo -e "${YELLOW}Installing wg-panel...${NC}"

cd /workspace
rm -rf wg-panel 2>/dev/null || true

# Clone or create from current directory
if [ -d "/workspace/wg-panel" ]; then
    echo -e "${GREEN}Using existing wg-panel directory${NC}"
else
    echo -e "${RED}Error: wg-panel directory not found${NC}"
    exit 1
fi

cd /workspace/wg-panel

# Create .env file
cat > .env << EOF
# Telegram Bot Settings
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
TELEGRAM_ADMIN_ID=$TELEGRAM_ADMIN_ID
TELEGRAM_BOT_USERNAME=$TELEGRAM_BOT_USERNAME

# WG-Easy API Settings
WG_EASY_URL=$WG_EASY_URL
WG_EASY_USERNAME=$WG_EASY_USERNAME
WG_EASY_PASSWORD=$WG_EASY_PASSWORD

# Panel Settings
PORT=3000
SESSION_SECRET=$(openssl rand -hex 32)
NODE_ENV=production
EOF

echo -e "${GREEN}✓ .env file created${NC}"

# Install npm dependencies
echo -e "${YELLOW}Installing npm dependencies...${NC}"
npm install --production
echo -e "${GREEN}✓ Dependencies installed${NC}"
echo ""

# Configure firewall
echo -e "${YELLOW}Configuring firewall...${NC}"

if command -v ufw &> /dev/null; then
    ufw allow 3000/tcp comment "WG Panel"
    ufw --force enable
    echo -e "${GREEN}✓ UFW configured (port 3000)${NC}"
elif command -v firewall-cmd &> /dev/null; then
    firewall-cmd --permanent --add-port=3000/tcp
    firewall-cmd --reload
    echo -e "${GREEN}✓ firewalld configured (port 3000)${NC}"
fi
echo ""

# Create systemd service
echo -e "${YELLOW}Creating systemd service...${NC}"

cat > /etc/systemd/system/wg-panel.service << EOF
[Unit]
Description=WG Panel - WireGuard Easy Management
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/workspace/wg-panel
ExecStart=/usr/bin/node app.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable wg-panel
systemctl start wg-panel

echo -e "${GREEN}✓ Systemd service created and started${NC}"
echo ""

# Final status
echo ""
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         Installation Complete!         ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}WG Panel is now running!${NC}"
echo ""
echo -e "${YELLOW}Access the panel at:${NC} http://YOUR_SERVER_IP:3000"
echo -e "${YELLOW}Check status:${NC} systemctl status wg-panel"
echo -e "${YELLOW}View logs:${NC} journalctl -u wg-panel -f"
echo -e "${YELLOW}Restart:${NC} systemctl restart wg-panel"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "1. Open http://YOUR_SERVER_IP:3000 in your browser"
echo "2. Login using Telegram widget"
echo "3. If you're the admin, approve pending requests"
echo "4. New users can create access requests via the panel"
echo ""
echo -e "${GREEN}Enjoy!${NC}"
