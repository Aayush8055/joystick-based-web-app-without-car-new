(function() {
    const WS_URL = 'ws://localhost:8080/ws';
    
    const canvas = document.getElementById('joystickCanvas');
    const ctx = canvas.getContext('2d');
    const joyXSpan = document.getElementById('joyXVal');
    const joyYSpan = document.getElementById('joyYVal');
    const angleMagSpan = document.getElementById('angleMag');
    const lastCmdSpan = document.getElementById('lastCmdField');
    const cmdLogDiv = document.getElementById('cmdLog');
    const ledIndicator = document.getElementById('ledIndicator');
    const wsStatusMsgSpan = document.getElementById('wsStatusMsg');
    const connBadge = document.getElementById('connBadge');
    const emergencyBtn = document.getElementById('emergencyStopBtn');
    const reconnectBtn = document.getElementById('reconnectBtn');

    let joystickActive = false;
    let joyX = 0, joyY = 0, magnitude = 0, angleDeg = 0;
    let centerX = 200, centerY = 200;
    let stickRadius = 155, knobRadius = 28;
    let socket = null;
    let intentionalClose = false;
    let animationId = null;

    function addCommandToLog(cmdStr, details = '') {
        const time = new Date().toLocaleTimeString();
        const div = document.createElement('div');
        div.innerHTML = `[${time}] ${cmdStr} ${details ? '→ ' + details : ''}`;
        cmdLogDiv.prepend(div);
        if(cmdLogDiv.children.length > 18) {
            cmdLogDiv.removeChild(cmdLogDiv.lastChild);
        }
    }

    function generateCommandText() {
        if(magnitude < 0.05) return "STOP";
        const absX = Math.abs(joyX);
        const absY = Math.abs(joyY);
        if(absY > absX) {
            if(joyY > 0) return "FORWARD";
            else return "BACKWARD";
        } else {
            if(joyX > 0) return "RIGHT";
            else return "LEFT";
        }
    }

    function sendJoyCommand() {
        if(!socket || socket.readyState !== WebSocket.OPEN) return;
        const payload = {
            type: "joystick",
            timestamp: Date.now(),
            x: parseFloat(joyX.toFixed(3)),
            y: parseFloat(joyY.toFixed(3)),
            magnitude: parseFloat(magnitude.toFixed(3)),
            angle_deg: parseFloat(angleDeg.toFixed(1)),
            command_text: generateCommandText()
        };
        socket.send(JSON.stringify(payload));
        lastCmdSpan.innerText = `${payload.command_text} (${payload.x}, ${payload.y})`;
    }

    function updateDisplayValues() {
        joyXSpan.innerText = joyX.toFixed(2);
        joyYSpan.innerText = joyY.toFixed(2);
        angleMagSpan.innerText = `${Math.round(angleDeg)}° | ${Math.floor(magnitude*100)}%`;
    }

    function drawJoystickWithKnobPosition(knobX, knobY) {
        ctx.clearRect(0, 0, 400, 400);
        ctx.beginPath();
        ctx.arc(centerX, centerY, stickRadius, 0, 2 * Math.PI);
        ctx.strokeStyle = "#3a86ffaa";
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.fillStyle = "#14243366";
        ctx.fill();
        
        ctx.beginPath();
        ctx.moveTo(centerX - stickRadius, centerY);
        ctx.lineTo(centerX + stickRadius, centerY);
        ctx.moveTo(centerX, centerY - stickRadius);
        ctx.lineTo(centerX, centerY + stickRadius);
        ctx.strokeStyle = "#2d4e7a";
        ctx.lineWidth = 1;
        ctx.stroke();
        
        ctx.font = "bold 14px 'Segoe UI'";
        ctx.fillStyle = "#c6e9ff";
        ctx.fillText("FWD", centerX-18, centerY-stickRadius+18);
        ctx.fillText("←", centerX-stickRadius+18, centerY+6);
        ctx.fillText("→", centerX+stickRadius-28, centerY+6);
        ctx.fillText("BWD", centerX-20, centerY+stickRadius-8);
        
        ctx.beginPath();
        ctx.arc(knobX, knobY, knobRadius, 0, 2 * Math.PI);
        ctx.fillStyle = "#32cdff";
        ctx.shadowBlur = 12;
        ctx.shadowColor = "#00aaff";
        ctx.fill();
        ctx.strokeStyle = "white";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(knobX, knobY, knobRadius-6, 0, 2 * Math.PI);
        ctx.fillStyle = "#ffffffcc";
        ctx.fill();
        ctx.shadowBlur = 0;
    }

    function drawJoystick() {
        let knobX = centerX + joyX * stickRadius;
        let knobY = centerY + joyY * stickRadius;
        drawJoystickWithKnobPosition(knobX, knobY);
    }

    function computeJoystickFromEvent(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        let canvasX = (clientX - rect.left) * scaleX;
        let canvasY = (clientY - rect.top) * scaleY;
        
        canvasX = Math.min(400, Math.max(0, canvasX));
        canvasY = Math.min(400, Math.max(0, canvasY));
        
        let dx = canvasX - centerX;
        let dy = canvasY - centerY;
        let distance = Math.hypot(dx, dy);
        let limitedDistance = Math.min(distance, stickRadius);
        if(distance > 0.01) {
            dx = dx / distance * limitedDistance;
            dy = dy / distance * limitedDistance;
        }
        let rawX = dx / stickRadius;
        let rawY = dy / stickRadius;
        rawX = Math.min(1, Math.max(-1, rawX));
        rawY = Math.min(1, Math.max(-1, rawY));
        joyX = rawX;
        joyY = rawY;
        magnitude = Math.hypot(joyX, joyY);
        if(magnitude < 0.02) {
            angleDeg = 0;
        } else {
            let angleRad = Math.atan2(joyY, joyX);
            angleDeg = (angleRad * 180 / Math.PI);
            if(angleDeg < 0) angleDeg += 360;
        }
        updateDisplayValues();
        drawJoystickWithKnobPosition(centerX + dx, centerY + dy);
        sendJoyCommand();
    }

    function resetJoystickPosition() {
        joyX = 0;
        joyY = 0;
        magnitude = 0;
        angleDeg = 0;
        updateDisplayValues();
        drawJoystick();
        if(socket && socket.readyState === WebSocket.OPEN) sendJoyCommand();
    }

    function emergencyStop() {
        if(socket && socket.readyState === WebSocket.OPEN) {
            const eStopPayload = {
                type: "emergency_stop",
                timestamp: Date.now(),
                command: "HALT"
            };
            socket.send(JSON.stringify(eStopPayload));
            addCommandToLog("🛑 EMERGENCY STOP", "Vehicle halted");
            lastCmdSpan.innerText = "EMERGENCY STOP";
        }
        resetJoystickPosition();
    }

    function handleStart(e) {
        e.preventDefault();
        joystickActive = true;
        const point = e.touches ? e.touches[0] : e;
        computeJoystickFromEvent(point.clientX, point.clientY);
    }

    function handleMove(e) {
        if(!joystickActive) return;
        e.preventDefault();
        const point = e.touches ? e.touches[0] : e;
        computeJoystickFromEvent(point.clientX, point.clientY);
    }

    function handleEnd(e) {
        if(!joystickActive) return;
        joystickActive = false;
        resetJoystickPosition();
        e.preventDefault();
    }

    function handleMouseLeave(e) {
        if(joystickActive) {
            joystickActive = false;
            resetJoystickPosition();
        }
    }

    function attachCanvasEvents() {
        canvas.addEventListener('mousedown', handleStart);
        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleEnd);
        canvas.addEventListener('mouseleave', handleMouseLeave);
        canvas.addEventListener('touchstart', handleStart, {passive: false});
        canvas.addEventListener('touchmove', handleMove, {passive: false});
        canvas.addEventListener('touchend', handleEnd);
        canvas.addEventListener('touchcancel', handleEnd);
    }

    function updateUIWebsocketStatus(isConnected) {
        if(isConnected) {
            ledIndicator.classList.add('active');
            wsStatusMsgSpan.innerText = 'WebSocket: LIVE';
            connBadge.innerText = '● CONNECTED';
            connBadge.style.color = '#5eff87';
            connBadge.style.borderLeftColor = '#5eff87';
        } else {
            ledIndicator.classList.remove('active');
            wsStatusMsgSpan.innerText = 'WebSocket: offline';
            connBadge.innerText = '✖ DISCONNECTED';
            connBadge.style.color = '#ff8866';
            connBadge.style.borderLeftColor = '#ff8866';
        }
    }

    function initWebSocket() {
        if(socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
            try { socket.close(); } catch(e) {}
        }
        intentionalClose = false;
        socket = new WebSocket(WS_URL);
        
        socket.onopen = () => {
            updateUIWebsocketStatus(true);
            addCommandToLog("🔌 WebSocket Connected", "Ready for control");
            resetJoystickPosition();
        };
        
        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if(data.type === 'motor') {
                    addCommandToLog("🤖 Motor", `L:${data.left} R:${data.right}`);
                }
            } catch(e) {}
        };
        
        socket.onerror = () => {
            updateUIWebsocketStatus(false);
            addCommandToLog("⚠️ WebSocket Error", "");
        };
        
        socket.onclose = () => {
            updateUIWebsocketStatus(false);
            if(!intentionalClose) {
                addCommandToLog("❌ Disconnected", "Reconnecting in 2s...");
                setTimeout(() => {
                    if(!intentionalClose) initWebSocket();
                }, 2000);
            }
        };
    }

    function reconnectWS() {
        intentionalClose = false;
        if(socket) { try { socket.close(); } catch(e) {} }
        initWebSocket();
        addCommandToLog("🔄 Manual Reconnect", "");
    }

    canvas.width = 400;
    canvas.height = 400;
    attachCanvasEvents();
    resetJoystickPosition();
    drawJoystick();
    initWebSocket();

    emergencyBtn.addEventListener('click', emergencyStop);
    reconnectBtn.addEventListener('click', reconnectWS);

    setInterval(() => {
        if(socket && socket.readyState === WebSocket.OPEN && magnitude > 0.05) {
            sendJoyCommand();
        }
    }, 100);

    window.addEventListener('beforeunload', () => {
        intentionalClose = true;
        if(socket && socket.readyState === WebSocket.OPEN) socket.close();
    });
})();