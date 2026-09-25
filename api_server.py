#!/usr/bin/env python3
"""
B&B Shuffle API Server - Engine V2

Stdlib-only JSON API (http.server) on port 8001 for the B&B Shuffle front-end.
It serves scenarios, custom card decks (plus card image uploads), profiles,
background images and an AI provider proxy that keeps the operator's key on the
server.

It does NOT serve static files - nginx serves the app and proxies /api/ here.
Everything persisted lives under data/ (scenarios/, custom-decks/, uploads/,
profiles/, ai-config.json). Responses are either bare JSON or a
{success, data} envelope, so clients must unwrap both. There is no
authentication and CORS is wide open, so run it on a trusted network only.
"""

import os
import json
import uuid
import base64
import logging
import mimetypes
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
import urllib.request
from urllib.error import HTTPError, URLError

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('bb-shuffle-api.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger('BB-Shuffle-API')

# Configuration
class Config:
    BASE_DIR = Path(__file__).parent
    DATA_DIR = BASE_DIR / "data"
    PROFILES_DIR = DATA_DIR / "profiles"
    UPLOADS_DIR = DATA_DIR / "uploads" / "backgrounds"
    # Custom Card Creator storage. Both live under data/, which is the only
    # volume-mounted directory, so user-created cards survive rebuilds.
    CUSTOM_DECKS_DIR = DATA_DIR / "custom-decks"
    CARD_IMAGES_DIR = DATA_DIR / "uploads" / "cards"
    
    # Create directories
    for dir_path in [DATA_DIR, PROFILES_DIR, UPLOADS_DIR, CUSTOM_DECKS_DIR, CARD_IMAGES_DIR]:
        dir_path.mkdir(parents=True, exist_ok=True)
    
    # File upload limits
    MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
    ALLOWED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.webp'}
    
    # Operator-provided shared AI key (server-side only, never exposed to the browser)
    AI_CONFIG_PATH = DATA_DIR / "ai-config.json"


def _atomic_write_text(path: Path, text: str, encoding: str = 'utf-8') -> None:
    """Atomically write text to path via a temp file in the same directory."""
    tmp_path = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    with open(tmp_path, 'w', encoding=encoding) as f:
        f.write(text)
    os.replace(tmp_path, path)


def _atomic_write_bytes(path: Path, content: bytes) -> None:
    """Atomically write bytes to path via a temp file in the same directory."""
    tmp_path = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    with open(tmp_path, 'wb') as f:
        f.write(content)
    os.replace(tmp_path, path)


def _write_json_atomic(path: Path, data: Any) -> None:
    """Atomically write a JSON document (pretty-printed, UTF-8) to path.

    Callers own the return value and the try/except, and the parent directory
    must already exist - this helper only serialises and writes.
    """
    _atomic_write_text(path, json.dumps(data, indent=2, ensure_ascii=False))


@dataclass
class Profile:
    id: str
    name: str
    created_at: str
    modified_at: str
    game_state: Dict[str, Any]
    settings: Dict[str, Any]
    
    @classmethod
    def create_new(cls, name: str) -> 'Profile':
        now = datetime.now().isoformat()
        return cls(
            id=str(uuid.uuid4()),
            name=name,
            created_at=now,
            modified_at=now,
            game_state={
                "turns": 10,
                "maxTurns": 10,
                "cardsRevealed": {"A": False, "B": False, "C": False, "D": False},
                "gameStatus": "active",
                "lastDiceRoll": None,
                "adminNotes": "",
                "currentScenario": {"A": "Not set", "B": "Not set", "C": "Not set", "D": "Not set"},
                "cardSections": {"inject": [], "procedure-plus3": [], "procedure-zero": []},
                "showAvailableCards": True
            },
            settings={
                "theme": "default",
                "autoRefresh": True,
                "refreshInterval": 30000,
                "backgroundImage": None
            }
        )

class ProfileManager:
    """Manages profile CRUD operations"""
    
    def __init__(self):
        self.profiles_dir = Config.PROFILES_DIR
    
    def list_profiles(self) -> List[Dict[str, Any]]:
        """Get list of all profiles"""
        profiles = []
        for profile_file in self.profiles_dir.glob("*.json"):
            try:
                with open(profile_file, 'r', encoding='utf-8') as f:
                    profile_data = json.load(f)
                    profiles.append({
                        "id": profile_data["id"],
                        "name": profile_data["name"],
                        "created_at": profile_data["created_at"],
                        "modified_at": profile_data["modified_at"]
                    })
            except Exception as e:
                logger.error(f"Error reading profile {profile_file}: {e}")
        
        return sorted(profiles, key=lambda x: x["modified_at"], reverse=True)
    
    def get_profile(self, profile_id: str) -> Optional[Profile]:
        """Get a specific profile by ID"""
        profile_file = self.profiles_dir / f"{profile_id}.json"
        if not profile_file.exists():
            return None
        
        try:
            with open(profile_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return Profile(**data)
        except Exception as e:
            logger.error(f"Error loading profile {profile_id}: {e}")
            return None
    
    def save_profile(self, profile: Profile) -> bool:
        """Save or update a profile"""
        profile.modified_at = datetime.now().isoformat()
        profile_file = self.profiles_dir / f"{profile.id}.json"
        
        try:
            _write_json_atomic(profile_file, asdict(profile))
            logger.info(f"Profile {profile.id} saved successfully")
            return True
        except Exception as e:
            logger.error(f"Error saving profile {profile.id}: {e}")
            return False
    
    def delete_profile(self, profile_id: str) -> bool:
        """Delete a profile"""
        profile_file = self.profiles_dir / f"{profile_id}.json"
        if not profile_file.exists():
            return False
        
        try:
            profile_file.unlink()
            logger.info(f"Profile {profile_id} deleted successfully")
            return True
        except Exception as e:
            logger.error(f"Error deleting profile {profile_id}: {e}")
            return False
    
    def create_profile(self, name: str) -> Optional[Profile]:
        """Create a new profile"""
        if not name or len(name.strip()) == 0:
            return None
        
        profile = Profile.create_new(name.strip())
        if self.save_profile(profile):
            return profile
        return None

class FileManager:
    """Manages background image uploads and deletions"""
    
    def __init__(self):
        self.uploads_dir = Config.UPLOADS_DIR
    
    def list_backgrounds(self) -> List[Dict[str, Any]]:
        """Get list of uploaded background images"""
        backgrounds = []
        for img_file in self.uploads_dir.glob("*"):
            if img_file.is_file() and img_file.suffix.lower() in Config.ALLOWED_EXTENSIONS:
                stat = img_file.stat()
                backgrounds.append({
                    "id": img_file.name,  # Use filename as ID
                    "filename": img_file.name,
                    "size": stat.st_size,
                    "uploaded_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    "url": f"/api/backgrounds/{img_file.name}"
                })
        
        return sorted(backgrounds, key=lambda x: x["uploaded_at"], reverse=True)
    
    def save_background(self, filename: str, content: bytes) -> Optional[Dict[str, Any]]:
        """Save an uploaded background image"""
        # Validate file extension
        file_ext = Path(filename).suffix.lower()
        if file_ext not in Config.ALLOWED_EXTENSIONS:
            logger.warning(f"Invalid file extension: {file_ext}")
            return None
        
        # Validate file size
        if len(content) > Config.MAX_FILE_SIZE:
            logger.warning(f"File too large: {len(content)} bytes")
            return None
        
        # Generate safe filename
        safe_filename = f"{uuid.uuid4().hex}{file_ext}"
        file_path = self.uploads_dir / safe_filename
        
        try:
            _atomic_write_bytes(file_path, content)

            stat = file_path.stat()
            result = {
                "id": safe_filename,  # Use filename as ID for deletion
                "filename": safe_filename,
                "original_name": filename,
                "size": stat.st_size,
                "uploaded_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                "url": f"/api/backgrounds/{safe_filename}"
            }
            
            logger.info(f"Background image saved: {safe_filename}")
            return result
            
        except Exception as e:
            logger.error(f"Error saving background image: {e}")
            return None
    
    def delete_background(self, filename: str) -> bool:
        """Delete a background image"""
        file_path = self.uploads_dir / filename
        if not file_path.exists() or not file_path.is_file():
            return False
        
        try:
            file_path.unlink()
            logger.info(f"Background image deleted: {filename}")
            return True
        except Exception as e:
            logger.error(f"Error deleting background image: {e}")
            return False
    
    def get_background(self, filename: str) -> Optional[bytes]:
        """Get background image content"""
        file_path = self.uploads_dir / filename
        if not file_path.exists() or not file_path.is_file():
            return None
        
        try:
            with open(file_path, 'rb') as f:
                return f.read()
        except Exception as e:
            logger.error(f"Error reading background image: {e}")
            return None


class ScenarioManager:
    """Manages scenario CRUD operations for the Scenario Library"""
    
    def __init__(self):
        self.scenarios_dir = Config.DATA_DIR / "scenarios"
        self.scenarios_dir.mkdir(parents=True, exist_ok=True)
    
    def list_scenarios(self) -> List[Dict[str, Any]]:
        """Get list of all scenarios"""
        scenarios = []
        for scenario_file in self.scenarios_dir.glob("*.json"):
            try:
                with open(scenario_file, 'r', encoding='utf-8') as f:
                    scenario_data = json.load(f)
                    scenarios.append(scenario_data)
            except Exception as e:
                logger.error(f"Error reading scenario {scenario_file}: {e}")
        
        # Sort by modified date descending
        return sorted(scenarios, key=lambda x: x.get("metadata", {}).get("modifiedAt", ""), reverse=True)
    
    def get_scenario(self, scenario_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific scenario by ID"""
        scenario_file = self.scenarios_dir / f"{scenario_id}.json"
        if not scenario_file.exists():
            return None
        
        try:
            with open(scenario_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error loading scenario {scenario_id}: {e}")
            return None
    
    def save_scenario(self, scenario: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Save a new scenario (assigns fresh UUID)"""
        # Always assign a fresh UUID
        scenario_id = str(uuid.uuid4())
        scenario["id"] = scenario_id
        
        # Ensure metadata exists
        if "metadata" not in scenario:
            scenario["metadata"] = {}
        
        now = datetime.now().isoformat()
        if not scenario["metadata"].get("createdAt"):
            scenario["metadata"]["createdAt"] = now
        scenario["metadata"]["modifiedAt"] = now
        
        # Ensure version is set
        if not scenario.get("version"):
            scenario["version"] = "1.0"
        
        scenario_file = self.scenarios_dir / f"{scenario_id}.json"
        
        try:
            _write_json_atomic(scenario_file, scenario)
            logger.info(f"Scenario {scenario_id} saved successfully")
            return scenario
        except Exception as e:
            logger.error(f"Error saving scenario: {e}")
            return None
    
    def update_scenario(self, scenario_id: str, scenario_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update an existing scenario"""
        scenario_file = self.scenarios_dir / f"{scenario_id}.json"
        if not scenario_file.exists():
            return None
        
        # Preserve the ID
        scenario_data["id"] = scenario_id
        
        # Update modified timestamp
        if "metadata" not in scenario_data:
            scenario_data["metadata"] = {}
        scenario_data["metadata"]["modifiedAt"] = datetime.now().isoformat()
        
        try:
            _write_json_atomic(scenario_file, scenario_data)
            logger.info(f"Scenario {scenario_id} updated successfully")
            return scenario_data
        except Exception as e:
            logger.error(f"Error updating scenario {scenario_id}: {e}")
            return None
    
    def delete_scenario(self, scenario_id: str) -> bool:
        """Delete a scenario"""
        scenario_file = self.scenarios_dir / f"{scenario_id}.json"
        if not scenario_file.exists():
            return False
        
        try:
            scenario_file.unlink()
            logger.info(f"Scenario {scenario_id} deleted successfully")
            return True
        except Exception as e:
            logger.error(f"Error deleting scenario {scenario_id}: {e}")
            return False


# ---------------------------------------------------------------------------
# Custom Card Creator storage
# ---------------------------------------------------------------------------

def _escape_html(value: str) -> str:
    """Minimal HTML escaping for the details list stored on custom cards."""
    return (str(value)
            .replace('&', '&amp;')
            .replace('<', '&lt;')
            .replace('>', '&gt;')
            .replace('"', '&quot;')
            .replace("'", '&#39;'))


class CustomCardManager:
    """Manages the single user-created "Custom Cards" expansion deck.

    Cards are stored in data/custom-decks/custom-cards.json using the same
    envelope as every other deck (title / revdate / link / data + cardback
    colour keys) so the game engine can load it unchanged. Rendered card PNGs
    live in data/uploads/cards/. Extra per-card fields (detection, tools,
    resources, artwork, style, enabled) are preserved so a card can be loaded
    back into the creator for editing.
    """

    DECK_ID = 'custom-cards'
    TITLE = 'Custom Cards'
    # 'consultant' is offered by the Card Creator UI and consumed by the Player
    # and Scenario Editor, so it must be accepted here too. 'exfil' is
    # vendor-only artwork and is deliberately not offered.
    VALID_TYPES = {'initial', 'pivot', 'c2', 'persist', 'procedure', 'inject', 'consultant'}
    VALID_ARTWORK = {'illustration', 'banner', 'none'}
    VALID_STYLES = {'app', 'classic'}
    MAX_IMAGE_BYTES = 6 * 1024 * 1024  # 6 MB rendered PNG ceiling

    def __init__(self):
        self.decks_dir = Config.CUSTOM_DECKS_DIR
        self.images_dir = Config.CARD_IMAGES_DIR
        self.decks_dir.mkdir(parents=True, exist_ok=True)
        self.images_dir.mkdir(parents=True, exist_ok=True)
        self.deck_path = self.decks_dir / f'{self.DECK_ID}.json'
        # Always materialise the deck file so the engine's expansion loader can
        # fetch it even before the first custom card exists.
        if not self.deck_path.exists():
            self._save_deck(self._empty_deck())

    # ----- deck envelope -----

    def _empty_deck(self) -> Dict[str, Any]:
        return {
            'title': self.TITLE,
            'revdate': datetime.now().strftime('%m-%d-%Y'),
            'link': '',
            'data': [],
            'red': '../../shared/decks/cardbacks/v1/init.webp',
            'yellow': '../../shared/decks/cardbacks/v1/pivot.webp',
            'brown': '../../shared/decks/cardbacks/v1/c2.webp',
            'purple': '../../shared/decks/cardbacks/v1/persist.webp',
            'grey': '../../shared/decks/cardbacks/v1/inject.webp',
            'green': '',
            'logo': ''
        }

    def _load_deck(self) -> Dict[str, Any]:
        if not self.deck_path.exists():
            return self._empty_deck()
        try:
            with open(self.deck_path, 'r', encoding='utf-8') as f:
                deck = json.load(f)
        except Exception as e:
            logger.error(f"Error reading custom deck: {e}")
            return self._empty_deck()
        if not isinstance(deck, dict) or not isinstance(deck.get('data'), list):
            return self._empty_deck()
        return deck

    def _save_deck(self, deck: Dict[str, Any]) -> bool:
        deck['title'] = deck.get('title') or self.TITLE
        deck['revdate'] = datetime.now().strftime('%m-%d-%Y')
        try:
            _write_json_atomic(self.deck_path, deck)
            return True
        except Exception as e:
            logger.error(f"Error saving custom deck: {e}")
            return False

    # ----- normalisation -----

    @staticmethod
    def _string_list(value) -> List[str]:
        if not value:
            return []
        if isinstance(value, list):
            return [str(v).strip() for v in value if str(v).strip()]
        return [line.strip() for line in str(value).splitlines() if line.strip()]

    @staticmethod
    def _details_html(resources: List[Dict[str, str]]) -> str:
        items = []
        for res in resources:
            text = str(res.get('text') or res.get('url') or '').strip()
            url = str(res.get('url') or '').strip()
            if not text and not url:
                continue
            label = _escape_html(text or url)
            if url.startswith(('http://', 'https://')):
                items.append(f'<li><a target="_blank" href="{_escape_html(url)}">{label}</a></li>')
            else:
                items.append(f'<li>{label}</li>')
        return ''.join(items)

    def _normalize(self, incoming: Dict[str, Any], existing: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        """Validate and normalise an incoming card. Returns None when unusable."""
        incoming = incoming if isinstance(incoming, dict) else {}
        existing = existing if isinstance(existing, dict) else {}

        name = str(incoming.get('name', existing.get('name', ''))).strip()
        ctype = str(incoming.get('type', existing.get('type', ''))).strip().lower()
        if not name or ctype not in self.VALID_TYPES:
            return None

        artwork = str(incoming.get('artwork', existing.get('artwork', ''))).strip().lower()
        if artwork not in self.VALID_ARTWORK:
            artwork = 'none' if ctype == 'inject' else 'illustration'

        style = str(incoming.get('style', existing.get('style', ''))).strip().lower()
        if style not in self.VALID_STYLES:
            style = 'app'

        raw_resources = incoming.get('resources', existing.get('resources', []))
        resources = []
        for res in (raw_resources if isinstance(raw_resources, list) else []):
            if isinstance(res, dict):
                text = str(res.get('text') or res.get('url') or '').strip()
                url = str(res.get('url') or '').strip()
            else:
                text, url = str(res).strip(), ''
            if text or url:
                resources.append({'text': text, 'url': url})

        detection = self._string_list(incoming.get('detection', existing.get('detection', [])))
        tools = self._string_list(incoming.get('tools', existing.get('tools', [])))
        is_scenario = ctype in ('initial', 'pivot', 'c2', 'persist')

        image = incoming.get('image', existing.get('image', ''))
        image = str(image).strip() if image else ''

        now = datetime.now().isoformat()
        return {
            'id': str(existing.get('id', '')),
            'name': name,
            'type': ctype,
            'description': str(incoming.get('description', existing.get('description', ''))).strip(),
            'image': image,
            'details': self._details_html(resources),
            'resources': resources,
            'detection': detection if is_scenario else [],
            'tools': tools if ctype == 'procedure' else [],
            'artwork': artwork,
            'style': style,
            'enabled': bool(incoming.get('enabled', existing.get('enabled', True))),
            'createdAt': existing.get('createdAt') or now,
            'modifiedAt': now
        }

    @staticmethod
    def _next_id(cards: List[Dict[str, Any]]) -> str:
        used = set()
        for card in cards:
            cid = str(card.get('id', ''))
            if cid.startswith('CC-'):
                try:
                    used.add(int(cid[3:]))
                except ValueError:
                    pass
        n = 1
        while n in used:
            n += 1
        return f'CC-{n:03d}'

    # ----- card CRUD -----

    def list_cards(self) -> List[Dict[str, Any]]:
        return self._load_deck().get('data', [])

    def get_card(self, card_id: str) -> Optional[Dict[str, Any]]:
        for card in self.list_cards():
            if str(card.get('id')) == str(card_id):
                return card
        return None

    def save_card(self, incoming: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        deck = self._load_deck()
        card = self._normalize(incoming)
        if not card:
            return None
        card['id'] = self._next_id(deck['data'])
        deck['data'].append(card)
        if not self._save_deck(deck):
            return None
        logger.info(f"Custom card {card['id']} created")
        return card

    def update_card(self, card_id: str, incoming: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        deck = self._load_deck()
        for idx, existing in enumerate(deck['data']):
            if str(existing.get('id')) != str(card_id):
                continue
            card = self._normalize(incoming, existing)
            if not card:
                return None
            card['id'] = existing.get('id')
            old_image = str(existing.get('image') or '')
            if old_image and old_image != card['image']:
                self._delete_image(old_image)
            deck['data'][idx] = card
            if not self._save_deck(deck):
                return None
            logger.info(f'Custom card {card_id} updated')
            return card
        return None

    def delete_card(self, card_id: str) -> Optional[bool]:
        deck = self._load_deck()
        keep, removed = [], None
        for existing in deck['data']:
            if str(existing.get('id')) == str(card_id):
                removed = existing
            else:
                keep.append(existing)
        if removed is None:
            return None
        deck['data'] = keep
        if not self._save_deck(deck):
            return None
        self._delete_image(str(removed.get('image') or ''))
        logger.info(f'Custom card {card_id} deleted')
        return True

    # ----- rendered card images -----

    def save_image(self, data_url: str) -> Optional[str]:
        """Decode a base64 PNG data URL into data/uploads/cards/ and return its app path."""
        if not isinstance(data_url, str) or not data_url.startswith('data:'):
            return None
        try:
            header, encoded = data_url.split(',', 1)
        except ValueError:
            return None
        if ';base64' not in header:
            return None
        mime = header[5:].split(';', 1)[0].strip().lower()
        if mime != 'image/png':
            return None
        try:
            content = base64.b64decode(encoded, validate=True)
        except Exception:
            return None
        if not content or len(content) > self.MAX_IMAGE_BYTES:
            return None
        filename = f'{uuid.uuid4().hex}.png'
        try:
            _atomic_write_bytes(self.images_dir / filename, content)
        except Exception as e:
            logger.error(f"Error saving card image: {e}")
            return None
        logger.info(f'Custom card image saved: {filename}')
        return f'../data/uploads/cards/{filename}'

    def _delete_image(self, image_path: str) -> None:
        """Best-effort removal of a rendered card PNG this manager owns."""
        filename = os.path.basename(str(image_path or ''))
        if not filename or not filename.lower().endswith('.png'):
            return
        target = self.images_dir / filename
        try:
            if target.exists() and target.is_file():
                target.unlink()
        except Exception as e:
            logger.error(f"Error deleting card image {filename}: {e}")


# ---------------------------------------------------------------------------
# Shared AI key (server-proxied) support
# ---------------------------------------------------------------------------
# Provider metadata for the server-side proxy. 'custom' is handled separately
# and requires an endpoint stored in the shared config.
AI_PROVIDERS = {
    'openai':     {'name': 'OpenAI',        'chat': 'https://api.openai.com/v1/chat/completions',                                                             'models': 'https://api.openai.com/v1/models',                            'defaultModel': 'gpt-4o-mini'},
    'anthropic':  {'name': 'Anthropic',     'chat': 'https://api.anthropic.com/v1/messages',                                                                 'models': 'https://api.anthropic.com/v1/models',                          'defaultModel': 'claude-3-sonnet-20240229'},
    'mistral':    {'name': 'Mistral',       'chat': 'https://api.mistral.ai/v1/chat/completions',                                                            'models': 'https://api.mistral.ai/v1/models',                             'defaultModel': 'mistral-small-latest'},
    'xai':        {'name': 'xAI (Grok)',    'chat': 'https://api.x.ai/v1/chat/completions',                                                                  'models': 'https://api.x.ai/v1/models',                                   'defaultModel': 'grok-3-mini'},
    'perplexity': {'name': 'Perplexity',    'chat': 'https://api.perplexity.ai/chat/completions',                                                            'models': 'https://api.perplexity.ai/models',                             'defaultModel': 'sonar'},
    'groq':       {'name': 'Groq',          'chat': 'https://api.groq.com/openai/v1/chat/completions',                                                       'models': 'https://api.groq.com/openai/v1/models',                        'defaultModel': 'llama-3.3-70b-versatile'},
    'deepseek':   {'name': 'DeepSeek',      'chat': 'https://api.deepseek.com/chat/completions',                                                             'models': 'https://api.deepseek.com/models',                              'defaultModel': 'deepseek-chat'},
    'gemini':     {'name': 'Google Gemini', 'chat': 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',                                'models': 'https://generativelanguage.googleapis.com/v1beta/openai/models',    'defaultModel': 'gemini-2.0-flash'},
}


def _http_json(url: str, payload: Optional[Dict[str, Any]] = None,
               headers: Optional[Dict[str, str]] = None,
               method: str = 'GET', timeout: int = 90):
    """Thin urllib JSON helper that raises a readable RuntimeError on failure."""
    req = urllib.request.Request(url, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    body_bytes = None
    if payload is not None:
        body_bytes = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    try:
        with urllib.request.urlopen(req, data=body_bytes, timeout=timeout) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except HTTPError as e:
        detail = ''
        try:
            raw = e.read().decode('utf-8')
            parsed = json.loads(raw)
            err = parsed.get('error') if isinstance(parsed.get('error'), dict) else {}
            detail = err.get('message') or (parsed.get('message') or '')
            if not detail and not isinstance(parsed.get('error'), dict):
                detail = parsed.get('error') or ''
            if not detail:
                detail = raw[:300]
        except Exception:
            detail = ''
        raise RuntimeError(detail or f'HTTP {e.code} from provider')
    except URLError as e:
        raise RuntimeError(f'Network error talking to the provider: {e.reason}')


class AiConfigManager:
    """Stores the operator's shared LLM key on the server only (data/ai-config.json).

    The key never leaves the server; browsers only use the proxy endpoints.
    """

    def __init__(self):
        self.path = Config.AI_CONFIG_PATH

    def load(self) -> Optional[Dict[str, str]]:
        data = {}
        if self.path.exists():
            try:
                with open(self.path, 'r', encoding='utf-8') as f:
                    data = json.load(f) or {}
            except Exception as e:
                logger.warning(f'Could not read AI config: {e}')
        # Env-var fallback (docker -e BB_AI_*), used when no file is present.
        if not data.get('provider'):
            provider = os.environ.get('BB_AI_PROVIDER', '').strip().lower()
            key = os.environ.get('BB_AI_API_KEY', '').strip()
            if provider and key:
                data = {
                    'provider': provider,
                    'apiKey': key,
                    'model': os.environ.get('BB_AI_MODEL', '').strip(),
                    'endpoint': os.environ.get('BB_AI_ENDPOINT', '').strip()
                }
        provider = data.get('provider') or ''
        if provider == 'custom' and data.get('endpoint'):
            return data  # custom endpoints may use an optional key
        if provider and data.get('apiKey'):
            return data
        return None

    def save(self, payload: Dict[str, Any]) -> Dict[str, str]:
        clean = {
            'provider': (payload.get('provider') or '').strip().lower(),
            'apiKey': (payload.get('apiKey') or '').strip(),
            'model': (payload.get('model') or '').strip(),
            'endpoint': (payload.get('endpoint') or '').strip()
        }
        provider = clean['provider']
        if provider not in AI_PROVIDERS and provider != 'custom':
            raise ValueError(f'Unsupported provider: {provider}')
        if provider == 'custom' and not clean['endpoint']:
            raise ValueError('A custom endpoint URL is required')
        if provider != 'custom' and not clean['apiKey']:
            raise ValueError('An API key is required')
        self.path.parent.mkdir(parents=True, exist_ok=True)
        _write_json_atomic(self.path, clean)
        return clean

    def clear(self) -> bool:
        if self.path.exists():
            self.path.unlink()
        return True

    def public(self) -> Dict[str, Any]:
        cfg = self.load()
        if not cfg:
            return {'configured': False}
        provider = cfg.get('provider') or ''
        name = 'Custom Endpoint' if provider == 'custom' else (AI_PROVIDERS.get(provider) or {}).get('name') or provider
        return {
            'configured': True,
            'provider': provider,
            'providerName': name,
            'model': cfg.get('model') or '',
            'customEndpoint': bool(cfg.get('endpoint'))
        }


class BBShuffleAPIHandler(BaseHTTPRequestHandler):
    """HTTP request handler for B&B Shuffle API"""
    
    def __init__(self, *args, **kwargs):
        self.profile_manager = ProfileManager()
        self.file_manager = FileManager()
        self.scenario_manager = ScenarioManager()
        self.custom_card_manager = CustomCardManager()
        self.ai_config_manager = AiConfigManager()
        super().__init__(*args, **kwargs)
    
    def do_OPTIONS(self):
        """Handle CORS preflight requests"""
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()
    
    def send_cors_headers(self):
        """Send CORS headers"""
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    
    def send_json_response(self, data: Any, status_code: int = 200):
        """Send JSON response"""
        self.send_response(status_code)
        self.send_cors_headers()
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        
        response_json = json.dumps(data, ensure_ascii=False, indent=2)
        self.wfile.write(response_json.encode('utf-8'))
    
    def send_error_response(self, message: str, status_code: int = 400):
        """Send error response"""
        self.send_json_response({
            "success": False,
            "error": message,
            "timestamp": datetime.now().isoformat()
        }, status_code)
    
    def parse_request_body(self) -> Optional[Dict[str, Any]]:
        """Parse JSON request body"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                return {}
            
            body = self.rfile.read(content_length)
            return json.loads(body.decode('utf-8'))
        except Exception as e:
            logger.error(f"Error parsing request body: {e}")
            return None
    
    def do_GET(self):
        """Handle GET requests"""
        parsed_url = urlparse(self.path)
        path = parsed_url.path
        
        try:
            if path == '/api/health':
                self.handle_health_check()
            elif path == '/api/profiles':
                self.handle_list_profiles()
            elif path.startswith('/api/profiles/'):
                profile_id = path.split('/')[-1]
                self.handle_get_profile(profile_id)
            elif path == '/api/backgrounds':
                self.handle_list_backgrounds()
            elif path.startswith('/api/backgrounds/'):
                filename = path.split('/')[-1]
                self.handle_get_background(filename)
            elif path == '/api/scenarios':
                self.handle_list_scenarios()
            elif path.startswith('/api/scenarios/'):
                scenario_id = path.split('/')[-1]
                self.handle_get_scenario(scenario_id)
            elif path == '/api/custom-cards':
                self.handle_list_custom_cards()
            elif path.startswith('/api/custom-cards/'):
                card_id = path.split('/')[-1]
                self.handle_get_custom_card(card_id)
            elif path == '/api/ai/config':
                self.handle_get_ai_config()
            elif path == '/api/ai/models':
                self.handle_ai_models()
            else:
                self.send_error_response("Endpoint not found", 404)
        except Exception as e:
            logger.error(f"Error handling GET request: {e}")
            self.send_error_response("Internal server error", 500)
    
    def do_POST(self):
        """Handle POST requests"""
        parsed_url = urlparse(self.path)
        path = parsed_url.path
        
        try:
            if path == '/api/profiles':
                self.handle_create_profile()
            elif path == '/api/backgrounds':
                self.handle_upload_background()
            elif path == '/api/scenarios':
                self.handle_create_scenario()
            elif path == '/api/custom-cards':
                self.handle_create_custom_card()
            elif path == '/api/custom-cards/image':
                self.handle_upload_custom_card_image()
            elif path == '/api/ai/config':
                self.handle_set_ai_config()
            elif path == '/api/ai/chat':
                self.handle_ai_chat()
            else:
                self.send_error_response("Endpoint not found", 404)
        except Exception as e:
            logger.error(f"Error handling POST request: {e}")
            self.send_error_response("Internal server error", 500)
    
    def do_PUT(self):
        """Handle PUT requests"""
        parsed_url = urlparse(self.path)
        path = parsed_url.path
        
        try:
            if path.startswith('/api/profiles/'):
                profile_id = path.split('/')[-1]
                self.handle_update_profile(profile_id)
            elif path.startswith('/api/scenarios/'):
                scenario_id = path.split('/')[-1]
                self.handle_update_scenario(scenario_id)
            elif path.startswith('/api/custom-cards/'):
                card_id = path.split('/')[-1]
                self.handle_update_custom_card(card_id)
            else:
                self.send_error_response("Endpoint not found", 404)
        except Exception as e:
            logger.error(f"Error handling PUT request: {e}")
            self.send_error_response("Internal server error", 500)
    
    def do_DELETE(self):
        """Handle DELETE requests"""
        parsed_url = urlparse(self.path)
        path = parsed_url.path
        
        try:
            if path.startswith('/api/profiles/'):
                profile_id = path.split('/')[-1]
                self.handle_delete_profile(profile_id)
            elif path.startswith('/api/backgrounds/'):
                filename = path.split('/')[-1]
                self.handle_delete_background(filename)
            elif path.startswith('/api/scenarios/'):
                scenario_id = path.split('/')[-1]
                self.handle_delete_scenario(scenario_id)
            elif path.startswith('/api/custom-cards/'):
                card_id = path.split('/')[-1]
                self.handle_delete_custom_card(card_id)
            elif path == '/api/ai/config':
                self.handle_clear_ai_config()
            else:
                self.send_error_response("Endpoint not found", 404)
        except Exception as e:
            logger.error(f"Error handling DELETE request: {e}")
            self.send_error_response("Internal server error", 500)
    
    # API endpoint handlers
    def handle_health_check(self):
        """Health check endpoint"""
        self.send_json_response({
            "success": True,
            "status": "healthy",
            "timestamp": datetime.now().isoformat(),
            "version": "2.0.0",
            "endpoints": [
                "GET /api/health",
                "GET /api/profiles",
                "POST /api/profiles",
                "GET /api/profiles/{id}",
                "PUT /api/profiles/{id}",
                "DELETE /api/profiles/{id}",
                "GET /api/backgrounds",
                "POST /api/backgrounds",
                "GET /api/backgrounds/{filename}",
                "DELETE /api/backgrounds/{filename}",
                "GET /api/scenarios",
                "POST /api/scenarios",
                "GET /api/scenarios/{id}",
                "PUT /api/scenarios/{id}",
                "DELETE /api/scenarios/{id}",
                "GET /api/custom-cards",
                "POST /api/custom-cards",
                "POST /api/custom-cards/image",
                "GET /api/custom-cards/{id}",
                "PUT /api/custom-cards/{id}",
                "DELETE /api/custom-cards/{id}",
                "GET /api/ai/config",
                "POST /api/ai/config",
                "DELETE /api/ai/config",
                "GET /api/ai/models",
                "POST /api/ai/chat"
            ]
        })
    
    def handle_list_profiles(self):
        """List all profiles"""
        profiles = self.profile_manager.list_profiles()
        self.send_json_response({
            "success": True,
            "data": profiles,
            "count": len(profiles)
        })
    
    def handle_get_profile(self, profile_id: str):
        """Get specific profile"""
        profile = self.profile_manager.get_profile(profile_id)
        if not profile:
            self.send_error_response("Profile not found", 404)
            return
        
        self.send_json_response({
            "success": True,
            "data": asdict(profile)
        })
    
    def handle_create_profile(self):
        """Create new profile"""
        data = self.parse_request_body()
        if not data:
            self.send_error_response("Invalid request body")
            return
        
        name = data.get('name', '').strip()
        if not name:
            self.send_error_response("Profile name is required")
            return
        
        profile = self.profile_manager.create_profile(name)
        if not profile:
            self.send_error_response("Failed to create profile")
            return
        
        self.send_json_response({
            "success": True,
            "data": asdict(profile)
        }, 201)
    
    def handle_update_profile(self, profile_id: str):
        """Update existing profile"""
        profile = self.profile_manager.get_profile(profile_id)
        if not profile:
            self.send_error_response("Profile not found", 404)
            return
        
        data = self.parse_request_body()
        if not data:
            self.send_error_response("Invalid request body")
            return
        
        # Update profile fields
        if 'name' in data:
            profile.name = data['name'].strip()
        if 'game_state' in data:
            profile.game_state.update(data['game_state'])
        if 'settings' in data:
            profile.settings.update(data['settings'])
        
        if self.profile_manager.save_profile(profile):
            self.send_json_response({
                "success": True,
                "data": asdict(profile)
            })
        else:
            self.send_error_response("Failed to update profile")
    
    def handle_delete_profile(self, profile_id: str):
        """Delete profile"""
        if self.profile_manager.delete_profile(profile_id):
            self.send_json_response({
                "success": True,
                "message": "Profile deleted successfully"
            })
        else:
            self.send_error_response("Profile not found", 404)
    
    def handle_list_backgrounds(self):
        """List background images"""
        backgrounds = self.file_manager.list_backgrounds()
        self.send_json_response({
            "success": True,
            "data": backgrounds,
            "count": len(backgrounds)
        })
    
    def handle_upload_background(self):
        """Upload background image"""
        try:
            # Parse multipart form data
            content_type = self.headers.get('Content-Type', '')
            
            if not content_type.startswith('multipart/form-data'):
                self.send_error_response("Multipart form data required")
                return
            
            # Get the boundary from content-type
            boundary = None
            for part in content_type.split(';'):
                if 'boundary=' in part:
                    boundary = part.split('boundary=')[1].strip()
                    break
            
            if not boundary:
                self.send_error_response("No boundary found in multipart data")
                return
            
            # Read the content
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > Config.MAX_FILE_SIZE * 2:  # Allow some overhead
                self.send_error_response("File too large")
                return
            
            post_data = self.rfile.read(content_length)
            
            # Parse multipart data manually (simplified)
            boundary_bytes = ('--' + boundary).encode()
            parts = post_data.split(boundary_bytes)
            
            file_content = None
            filename = None
            
            for part in parts:
                if b'Content-Disposition: form-data' in part and b'filename=' in part:
                    # Extract filename
                    lines = part.split(b'\r\n')
                    for line in lines:
                        if b'Content-Disposition:' in line and b'filename=' in line:
                            filename_part = line.decode().split('filename=')[1]
                            filename = filename_part.strip('"').strip("'")
                            break
                    
                    # Extract file content (after double CRLF)
                    content_start = part.find(b'\r\n\r\n')
                    if content_start != -1:
                        file_content = part[content_start + 4:].rstrip(b'\r\n')
                        break
            
            if not filename or not file_content:
                self.send_error_response("No file found in upload data")
                return
            
            # Validate file extension
            file_ext = Path(filename).suffix.lower()
            if file_ext not in Config.ALLOWED_EXTENSIONS:
                self.send_error_response(f"Invalid file extension: {file_ext}")
                return
            
            # Validate file size
            if len(file_content) > Config.MAX_FILE_SIZE:
                self.send_error_response(f"File too large: {len(file_content)} bytes > {Config.MAX_FILE_SIZE}")
                return
            
            # Save the file
            file_info = self.file_manager.save_background(filename, file_content)
            if file_info:
                self.send_json_response({
                    "success": True,
                    "file": file_info,
                    "message": "File uploaded successfully"
                })
                logger.info(f"Background uploaded successfully: {filename}")
            else:
                self.send_error_response("Failed to save file")
                
        except Exception as e:
            logger.error(f"Error uploading background: {e}")
            self.send_error_response(f"Upload failed: {str(e)}")
    
    
    def handle_get_background(self, filename: str):
        """Get background image"""
        content = self.file_manager.get_background(filename)
        if not content:
            self.send_error_response("Background image not found", 404)
            return
        
        # Determine content type
        mime_type, _ = mimetypes.guess_type(filename)
        if not mime_type:
            mime_type = 'application/octet-stream'
        
        self.send_response(200)
        self.send_cors_headers()
        self.send_header('Content-Type', mime_type)
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)
    
    def handle_delete_background(self, filename: str):
        """Delete background image"""
        if self.file_manager.delete_background(filename):
            self.send_json_response({
                "success": True,
                "message": "Background image deleted successfully"
            })
        else:
            self.send_error_response("Background image not found", 404)

    # Scenario handlers
    def handle_list_scenarios(self):
        """List all scenarios"""
        scenarios = self.scenario_manager.list_scenarios()
        self.send_json_response({
            "success": True,
            "data": scenarios,
            "count": len(scenarios)
        })
    
    def handle_get_scenario(self, scenario_id: str):
        """Get specific scenario"""
        scenario = self.scenario_manager.get_scenario(scenario_id)
        if not scenario:
            self.send_error_response("Scenario not found", 404)
            return
        
        self.send_json_response({
            "success": True,
            "data": scenario
        })
    
    def handle_create_scenario(self):
        """Create new scenario"""
        data = self.parse_request_body()
        if not data:
            self.send_error_response("Invalid request body")
            return
        
        scenario = self.scenario_manager.save_scenario(data)
        if scenario:
            self.send_json_response({
                "success": True,
                "data": scenario,
                "message": "Scenario created successfully"
            }, 201)
        else:
            self.send_error_response("Failed to create scenario")
    
    def handle_update_scenario(self, scenario_id: str):
        """Update existing scenario"""
        data = self.parse_request_body()
        if not data:
            self.send_error_response("Invalid request body")
            return
        
        scenario = self.scenario_manager.update_scenario(scenario_id, data)
        if scenario:
            self.send_json_response({
                "success": True,
                "data": scenario,
                "message": "Scenario updated successfully"
            })
        else:
            self.send_error_response("Scenario not found", 404)
    
    def handle_delete_scenario(self, scenario_id: str):
        """Delete scenario"""
        if self.scenario_manager.delete_scenario(scenario_id):
            self.send_json_response({
                "success": True,
                "message": "Scenario deleted successfully"
            })
        else:
            self.send_error_response("Scenario not found", 404)

    # Custom card handlers
    def handle_list_custom_cards(self):
        """List every card in the user-created Custom Cards deck"""
        cards = self.custom_card_manager.list_cards()
        self.send_json_response({
            "success": True,
            "title": self.custom_card_manager.TITLE,
            "data": cards,
            "count": len(cards)
        })

    def handle_get_custom_card(self, card_id: str):
        """Get a single custom card by id"""
        card = self.custom_card_manager.get_card(card_id)
        if not card:
            self.send_error_response("Custom card not found", 404)
            return
        self.send_json_response({"success": True, "data": card})

    def handle_create_custom_card(self):
        """Create a custom card"""
        data = self.parse_request_body()
        if data is None:
            self.send_error_response("Invalid request body")
            return
        card = self.custom_card_manager.save_card(data)
        if card:
            self.send_json_response({
                "success": True,
                "data": card,
                "message": "Custom card created successfully"
            }, 201)
        else:
            self.send_error_response("Failed to create custom card (name and a valid type are required)")

    def handle_update_custom_card(self, card_id: str):
        """Update an existing custom card"""
        data = self.parse_request_body()
        if data is None:
            self.send_error_response("Invalid request body")
            return
        card = self.custom_card_manager.update_card(card_id, data)
        if card:
            self.send_json_response({
                "success": True,
                "data": card,
                "message": "Custom card updated successfully"
            })
        else:
            self.send_error_response("Custom card not found", 404)

    def handle_delete_custom_card(self, card_id: str):
        """Delete a custom card and its rendered image"""
        if self.custom_card_manager.delete_card(card_id):
            self.send_json_response({
                "success": True,
                "message": "Custom card deleted successfully"
            })
        else:
            self.send_error_response("Custom card not found", 404)

    def handle_upload_custom_card_image(self):
        """Store a rendered card PNG (sent as a base64 data URL) under data/uploads/cards/"""
        data = self.parse_request_body()
        if data is None:
            self.send_error_response("Invalid request body")
            return
        data_url = data.get("dataUrl") or ""
        path = self.custom_card_manager.save_image(data_url)
        if path:
            self.send_json_response({
                "success": True,
                "path": path,
                "message": "Card image stored"
            }, 201)
        else:
            self.send_error_response("Invalid image (expected a base64 PNG data URL under 6 MB)")

    # ---- Shared AI key (server-proxied) endpoints ----

    def handle_get_ai_config(self):
        """Return public info about the shared AI key (never the key itself)."""
        self.send_json_response({
            "success": True,
            **self.ai_config_manager.public()
        })

    def handle_set_ai_config(self):
        """Store the operator's shared AI provider + key on the server."""
        data = self.parse_request_body()
        if not data:
            self.send_error_response("Invalid request body")
            return
        try:
            self.ai_config_manager.save(data)
        except ValueError as e:
            self.send_error_response(str(e), 400)
            return
        self.send_json_response({
            "success": True,
            "message": "Shared AI key saved",
            **self.ai_config_manager.public()
        })

    def handle_clear_ai_config(self):
        """Remove the shared AI key from the server."""
        self.ai_config_manager.clear()
        self.send_json_response({
            "success": True,
            "message": "Shared AI key removed"
        })

    def handle_ai_models(self):
        """List the shared provider's models (via the server-side key)."""
        cfg = self.ai_config_manager.load()
        if not cfg:
            self.send_error_response("No shared AI key is configured on the server", 400)
            return
        provider = cfg['provider']
        key = cfg.get('apiKey') or ''
        try:
            if provider == 'custom':
                endpoint = cfg.get('endpoint') or ''
                url = endpoint.replace('/chat/completions', '').rstrip('/') + '/models' if endpoint else ''
                headers = {'Accept': 'application/json'}
                if key:
                    headers['Authorization'] = f'Bearer {key}'
            else:
                meta = AI_PROVIDERS.get(provider)
                if not meta:
                    raise RuntimeError(f'Unsupported provider: {provider}')
                url = meta['models']
                headers = {'Accept': 'application/json'}
                if provider == 'anthropic':
                    headers['x-api-key'] = key
                    headers['anthropic-version'] = '2023-06-01'
                else:
                    headers['Authorization'] = f'Bearer {key}'
            if not url:
                raise RuntimeError('No model-list endpoint for this provider')

            data = _http_json(url, None, headers, method='GET', timeout=60)
            items = []
            if isinstance(data, list):
                items = data
            elif isinstance(data.get('data'), list):
                items = data['data']
            elif isinstance(data.get('models'), list):
                items = data['models']
            models, seen = [], set()
            for item in items:
                if isinstance(item, str):
                    mid = item
                elif isinstance(item, dict):
                    mid = item.get('id') or item.get('name') or item.get('model') or item.get('model_name') or ''
                else:
                    continue
                mid = str(mid).strip()
                if mid and mid not in seen:
                    seen.add(mid)
                    models.append(mid)
            models.sort(key=lambda s: s.lower())
            self.send_json_response({'success': True, 'models': models})
        except Exception as e:
            logger.error(f'AI model list error: {e}')
            self.send_error_response(str(e) or 'Could not load models', 502)

    def handle_ai_chat(self):
        """Proxy a chat request to the shared provider using the server-side key."""
        cfg = self.ai_config_manager.load()
        if not cfg:
            self.send_error_response("No shared AI key is configured on the server", 400)
            return
        provider = cfg['provider']
        body = self.parse_request_body() or {}
        messages = body.get('messages') or []
        temperature = body.get('temperature')
        max_tokens = int(body.get('maxTokens') or 2000)
        key = cfg.get('apiKey') or ''
        try:
            if provider == 'custom':
                url = cfg.get('endpoint') or ''
                if not url:
                    raise RuntimeError('Custom endpoint not configured')
                payload = {
                    'messages': messages,
                    'temperature': temperature if temperature is not None else 0.7,
                    'max_tokens': max_tokens
                }
                headers = {'Content-Type': 'application/json'}
                if key:
                    headers['Authorization'] = f'Bearer {key}'
            elif provider == 'anthropic':
                meta = AI_PROVIDERS['anthropic']
                model = body.get('model') or cfg.get('model') or meta['defaultModel']
                payload = {'model': model, 'messages': messages, 'max_tokens': max_tokens}
                headers = {'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01'}
                url = meta['chat']
            else:
                meta = AI_PROVIDERS.get(provider)
                if not meta:
                    raise RuntimeError(f'Unsupported provider: {provider}')
                model = body.get('model') or cfg.get('model') or meta['defaultModel']
                payload = {
                    'model': model,
                    'messages': messages,
                    'temperature': temperature if temperature is not None else 0.7,
                    'max_tokens': max_tokens
                }
                headers = {'Content-Type': 'application/json', 'Authorization': f'Bearer {key}'}
                url = meta['chat']

            data = _http_json(url, payload, headers, method='POST', timeout=120)
            if provider == 'anthropic':
                content = ((data.get('content') or [{}])[0] or {}).get('text', '')
            else:
                content = (((data.get('choices') or [{}])[0] or {}).get('message') or {}).get('content', '')
            if not content:
                raise RuntimeError('Provider returned an empty response')
            self.send_json_response({'success': True, 'content': content})
        except Exception as e:
            logger.error(f'AI proxy error: {e}')
            self.send_error_response(str(e) or 'AI proxy request failed', 502)


def run_server(port: int = 8001):
    """Run the API server"""
    server_address = ('0.0.0.0', port)
    httpd = HTTPServer(server_address, BBShuffleAPIHandler)
    
    logger.info(f"Starting B&B Shuffle API server on port {port}")
    logger.info(f"API documentation available at http://localhost:{port}/api/health")
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        logger.info("Server stopped by user")
    finally:
        httpd.server_close()

if __name__ == '__main__':
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8001
    run_server(port)
