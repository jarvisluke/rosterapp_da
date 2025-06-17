from typing import Dict, Any
from fastapi import WebSocket
from uuid import uuid4
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

ws_logger = logging.getLogger('websocket')

class WebSocketManager:
    """Singleton manager for WebSocket connections with lifecycle management"""

    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.logger = ws_logger

    async def connect(self, websocket: WebSocket) -> str:
        """Accept websocket connection and return a unique client_id"""
        try:
            self.logger.info("Accepting websocket connection")
            await websocket.accept()
            client_id = str(uuid4())
            self.active_connections[client_id] = websocket
            self.logger.info(f"Client {client_id} connected. Total connections: {len(self.active_connections)}")
            return client_id
        except Exception as e:
            self.logger.error(f"Error accepting connection: {e}")
            raise

    def disconnect(self, client_id: str) -> None:
        """Remove a client from active connections"""
        websocket = self.active_connections.pop(client_id, None)
        if websocket:
            self.logger.info(f"Client {client_id} disconnected. Total connections: {len(self.active_connections)}")

    async def send_message(self, client_id: str, message: Dict[str, Any]) -> bool:
        """Send a message to a specific client"""
        websocket = self.active_connections.get(client_id)
        if websocket:
            try:
                await websocket.send_json(message)
                return True
            except Exception as e:
                self.logger.error(f"Error sending message to {client_id}: {e}")
                self.disconnect(client_id)
        return False

    async def broadcast(self, message: Dict[str, Any]) -> None:
        """Broadcast message to all connected clients"""
        disconnected_clients = []
        for client_id, websocket in list(self.active_connections.items()):
            try:
                await websocket.send_json(message)
            except Exception as e:
                self.logger.error(f"Error broadcasting to client {client_id}: {e}")
                disconnected_clients.append(client_id)

        # Clean up disconnected clients
        for client_id in disconnected_clients:
            self.disconnect(client_id)

    def get_connection_count(self) -> int:
        """Return number of active connections"""
        return len(self.active_connections)

    def is_connected(self, client_id: str) -> bool:
        """Check if a client is still connected"""
        return client_id in self.active_connections

# Dependency injection function using global state
async def get_websocket_manager(websocket: WebSocket) -> WebSocketManager:
    return websocket.app.state.websocket_manager
