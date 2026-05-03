const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const SerialPort = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, '/')));

let arduinoPort = null;
let currentMotorLeft = 0;
let currentMotorRight = 0;

function initSerialPort() {
    SerialPort.SerialPort.list().then(ports => {
        const arduinoPorts = ports.filter(p => p.manufacturer && p.manufacturer.toLowerCase().includes('arduino'));
        if (arduinoPorts.length > 0) {
            const portPath = arduinoPorts[0].path;
            arduinoPort = new SerialPort.SerialPort({ path: portPath, baudRate: 9600 });
            const parser = arduinoPort.pipe(new ReadlineParser({ delimiter: '\n' }));
            parser.on('data', (data) => {
                console.log('Arduino:', data.trim());
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'arduino_log', message: data.trim() }));
                    }
                });
            });
            arduinoPort.on('open', () => console.log('Arduino connected on', portPath));
            arduinoPort.on('error', (err) => console.log('Serial error:', err.message));
        } else {
            console.log('No Arduino found, running in simulation mode');
        }
    }).catch(err => console.log('Serial port list error:', err));
}

function sendToArduino(leftSpeed, rightSpeed) {
    if (arduinoPort && arduinoPort.isOpen) {
        const command = `${Math.round(leftSpeed)},${Math.round(rightSpeed)}\n`;
        arduinoPort.write(command);
        console.log('Sent to Arduino:', command.trim());
    }
}

function mapJoystickToMotor(x, y, magnitude) {
    if (magnitude < 0.05) return { left: 0, right: 0 };
    
    const maxSpeed = 255;
    const deadzone = 0.1;
    let leftSpeed = 0, rightSpeed = 0;
    
    const forward = y > 0 ? y : 0;
    const backward = y < 0 ? -y : 0;
    const turn = x;
    
    if (forward > deadzone) {
        leftSpeed = forward * maxSpeed;
        rightSpeed = forward * maxSpeed;
        if (turn > deadzone) {
            leftSpeed = leftSpeed * (1 - turn * 0.7);
        } else if (turn < -deadzone) {
            rightSpeed = rightSpeed * (1 + turn * 0.7);
        }
    } else if (backward > deadzone) {
        leftSpeed = -backward * maxSpeed;
        rightSpeed = -backward * maxSpeed;
        if (turn > deadzone) {
            leftSpeed = leftSpeed * (1 - turn * 0.7);
        } else if (turn < -deadzone) {
            rightSpeed = rightSpeed * (1 + turn * 0.7);
        }
    } else {
        leftSpeed = turn * maxSpeed;
        rightSpeed = -turn * maxSpeed;
    }
    
    leftSpeed = Math.min(maxSpeed, Math.max(-maxSpeed, leftSpeed));
    rightSpeed = Math.min(maxSpeed, Math.max(-maxSpeed, rightSpeed));
    
    return { left: Math.round(leftSpeed), right: Math.round(rightSpeed) };
}

wss.on('connection', (ws) => {
    console.log('Client connected');
    ws.send(JSON.stringify({ type: 'ack', message: 'Joystick backend ready!' }));
    
    ws.on('message', (data) => {
        try {
            const command = JSON.parse(data.toString());
            
            if (command.type === 'joystick') {
                const motorCmds = mapJoystickToMotor(command.x, command.y, command.magnitude);
                currentMotorLeft = motorCmds.left;
                currentMotorRight = motorCmds.right;
                sendToArduino(currentMotorLeft, currentMotorRight);
                
                ws.send(JSON.stringify({ 
                    type: 'motor_command', 
                    left: currentMotorLeft, 
                    right: currentMotorRight,
                    command_text: command.command_text 
                }));
                
                console.log(`Joystick: x=${command.x}, y=${command.y} | Motors: L=${currentMotorLeft} R=${currentMotorRight}`);
            }
            
            if (command.type === 'emergency_stop') {
                console.log('EMERGENCY STOP - Motors Halted');
                sendToArduino(0, 0);
                currentMotorLeft = 0;
                currentMotorRight = 0;
                ws.send(JSON.stringify({ type: 'emergency_ack', status: 'halted' }));
            }
        } catch(e) {
            console.log('Invalid JSON:', data.toString());
        }
    });
    
    ws.on('close', () => {
        console.log('Client disconnected');
        sendToArduino(0, 0);
        currentMotorLeft = 0;
        currentMotorRight = 0;
    });
});

setInterval(() => {
    for(let client of wss.clients) {
        if(client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        }
    }
}, 30000);

initSerialPort();

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
});