import asyncio
from typing import Callable, Dict, List, Any
from datetime import datetime

class EventBus:
    """In-memory event bus with async delivery to subscribers (Hologram, SOS, Audit)."""
    def __init__(self):
        self._subscribers: Dict[str, List[Callable[[Dict[str, Any]], Any]]] = {}

    def subscribe(self, event_type: str, callback: Callable[[Dict[str, Any]], Any]):
        if event_type not in self._subscribers:
            self._subscribers[event_type] = []
        self._subscribers[event_type].append(callback)

    async def publish(self, event_type: str, payload: Dict[str, Any]):
        event = {
            "type": event_type,
            "payload": payload,
            "timestamp": datetime.utcnow().isoformat()
        }
        if event_type in self._subscribers:
            for cb in self._subscribers[event_type]:
                try:
                    if asyncio.iscoroutinefunction(cb):
                        await cb(event)
                    else:
                        cb(event)
                except Exception as err:
                    print(f"[EventBus] Error in handler for {event_type}: {err}")

# Global instance for DORA module
event_bus = EventBus()
