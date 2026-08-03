from flask import Flask, request, jsonify, send_from_directory, render_template
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import text, or_
import json
import hashlib
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.exceptions import HTTPException, BadRequest
import re
from werkzeug.utils import secure_filename
import os
from pathlib import Path
from PIL import Image, ImageOps, UnidentifiedImageError

CLASSIFICATION_CATEGORIES = [
    'Cocktail', 'Highball', 'Collins', 'Rickey', 'Buck', 'Fizz', 'Julep',
    'Smash', 'Cobbler', 'Swizzle', 'Sling', 'Toddy', 'Punch', 'Cup', 'Flip',
    'Nog', 'Fix', 'Crusta', 'Frappé', 'Shrub', 'Wassail Bowl',
    'Champerelle', 'Other', 'Ingredient',
]
COCKTAIL_SUBTYPES = ['Sour', 'Aromatic', 'Old-Fashioned', 'Improved', 'Daisy']
INGREDIENT_SUBTYPES = ['Base', 'Modifier', 'Special Flavoring', 'Garnish', 'Other']

GLASS_ICON_LOOKUP = [
    (['champagne saucer', 'champagne glass', 'saucer', 'coupe'], 'glass-champagne-saucer-size.svg'),
    (['collins'], 'glass-collins-size.svg'),
    (['highball'], 'glass-highball-size.svg'),
    (['tiki mug', 'tiki', 'tiki glass', 'totem mug'], 'glass-tiki-mug-size.svg'),
    (['nick nora', 'nick and nora', 'nick & nora', 'nick nora glass'], 'glass-nick-and-nora-size.svg'),
    (['old fashioned', 'old-fashioned', 'whisky tumbler', 'whiskey tumbler', 'tumbler'], 'glass-old-fashioned-size.svg'),
]

LEGACY_CLASSIFICATION_MAP = {
    'sour': ('Cocktail', 'Sour'),
    'aromatic': ('Cocktail', 'Aromatic'),
    'old-fashioned': ('Cocktail', 'Old-Fashioned'),
    'old fashioned': ('Cocktail', 'Old-Fashioned'),
    'improved': ('Cocktail', 'Improved'),
    'daisy': ('Cocktail', 'Daisy'),
}


def parse_tags(value):
    if value is None:
        return []
    if isinstance(value, list):
        return [str(t).strip() for t in value if str(t).strip()]
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return [str(t).strip() for t in parsed if str(t).strip()]
        except Exception:
            return [part.strip() for part in value.split(',') if part.strip()]
    return []


def normalize_tool_name(value):
    text = str(value or '').lower()
    text = re.sub(r'[^a-z0-9]+', ' ', text)
    return text.strip()


def _glass_icon_for_name(name):
    normalized_name = normalize_tool_name(name)
    if not normalized_name:
        return None
    for aliases, filename in GLASS_ICON_LOOKUP:
        for alias in aliases:
            normalized_alias = normalize_tool_name(alias)
            if normalized_alias and normalized_alias in normalized_name:
                return filename
    return None


def infer_glassware_name_from_tools(tools):
    for tool in tools:
        tool_name = tool.tool.name if tool and tool.tool else None
        if _glass_icon_for_name(tool_name):
            return tool_name
    return None


def choose_glass_icon(glassware, tools):
    icon_from_glassware = _glass_icon_for_name(glassware)
    if icon_from_glassware:
        return icon_from_glassware

    for tool in tools:
        tool_name = tool.tool.name if tool and tool.tool else None
        icon_from_tool = _glass_icon_for_name(tool_name)
        if icon_from_tool:
            return icon_from_tool
    return None


def format_tags(tags):
    return json.dumps([str(t).strip() for t in (tags or []) if str(t).strip()])


def normalize_score(value, *, missing_default=0):
    """Normalize score input.

    - Missing score defaults to unrated (0)
    - Null/blank score is stored as 0 (unrated sentinel)
    - Numeric score is clamped to 1..10
    """
    if value is None:
        return 0
    if isinstance(value, str):
        stripped = value.strip()
        if stripped == '':
            return 0
        value = stripped
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return missing_default
    return max(1, min(10, parsed))


def display_score(value):
    """Return API-facing score, mapping unrated sentinel to null."""
    if value is None:
        return None
    return value if int(value) >= 1 else None


def map_legacy_classification(value):
    if not value:
        return None, None
    raw = str(value).strip()
    key = raw.lower()
    if key in LEGACY_CLASSIFICATION_MAP:
        return LEGACY_CLASSIFICATION_MAP[key]
    if key == 'cocktail':
        return 'Cocktail', None
    for category in CLASSIFICATION_CATEGORIES:
        if category.lower() == key:
            return category, None
    return raw, None
import logging
from datetime import datetime, timedelta
from functools import wraps

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)


def _read_app_version():
    try:
        return Path(__file__).with_name('VERSION').read_text(encoding='utf-8').strip() or 'dev'
    except OSError:
        return 'dev'


APP_VERSION = _read_app_version()

cookie_secure = os.environ.get('COOKIE_SECURE', 'false').lower() == 'true'
cookie_samesite = os.environ.get('COOKIE_SAMESITE', 'Lax')

app.config.update(
    SECRET_KEY=os.environ.get('SECRET_KEY', 'dev-secret-CHANGE-THIS'),
    SQLALCHEMY_DATABASE_URI=os.environ.get('DATABASE_URL', 'sqlite:////data/cocktails.db'),
    UPLOAD_FOLDER=os.environ.get('UPLOAD_FOLDER', '/data/uploads'),
    MAX_CONTENT_LENGTH=32 * 1024 * 1024,
    SESSION_PERMANENT=True,
    PERMANENT_SESSION_LIFETIME=timedelta(days=7),
    SQLALCHEMY_TRACK_MODIFICATIONS=False,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE=cookie_samesite,
    SESSION_COOKIE_SECURE=cookie_secure,
    REMEMBER_COOKIE_DURATION=timedelta(days=60),
    REMEMBER_COOKIE_HTTPONLY=True,
    REMEMBER_COOKIE_SAMESITE=cookie_samesite,
    REMEMBER_COOKIE_SECURE=cookie_secure,
)

db = SQLAlchemy(app)
login_manager = LoginManager(app)
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp', 'gif'}
MAX_UPLOAD_IMAGE_DIM = 1600
MAX_UPLOAD_THUMB_DIM = 480
UPLOAD_IMAGE_QUALITY = 82
UPLOAD_THUMB_QUALITY = 76


def _thumbnail_filename(filename):
    stem, _ = os.path.splitext(filename)
    return f'{stem}__thumb.webp'


def _delete_upload_artifacts(filename):
    if not filename:
        return
    paths = [
        os.path.join(app.config['UPLOAD_FOLDER'], filename),
        os.path.join(app.config['UPLOAD_FOLDER'], _thumbnail_filename(filename)),
    ]
    for path in paths:
        try:
            if os.path.exists(path):
                os.remove(path)
        except OSError:
            logger.warning('Failed to remove upload artifact: %s', path)


def _optimize_and_save_upload(file_storage, output_path, thumb_output_path=None):
    """Normalize uploaded image for web delivery.

    - Applies EXIF orientation (mobile camera friendliness)
    - Resizes to a max edge length
    - Saves full-size and optional thumbnail as WebP for good quality/size balance
    """
    file_storage.stream.seek(0)
    with Image.open(file_storage.stream) as img:
        img = ImageOps.exif_transpose(img)
        if img.mode not in ('RGB', 'RGBA'):
            img = img.convert('RGBA' if 'A' in img.getbands() else 'RGB')
        full = img.copy()
        full.thumbnail((MAX_UPLOAD_IMAGE_DIM, MAX_UPLOAD_IMAGE_DIM), Image.Resampling.LANCZOS)
        full.save(output_path, format='WEBP', quality=UPLOAD_IMAGE_QUALITY, method=6)

        if thumb_output_path:
            thumb = img.copy()
            thumb.thumbnail((MAX_UPLOAD_THUMB_DIM, MAX_UPLOAD_THUMB_DIM), Image.Resampling.LANCZOS)
            thumb.save(thumb_output_path, format='WEBP', quality=UPLOAD_THUMB_QUALITY, method=6)

# ── Models ───────────────────────────────────────────────────────────────────

class User(UserMixin, db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    role = db.Column(db.String(20), default='user')  # 'admin' or 'user'

    def set_password(self, pw):
        self.password_hash = generate_password_hash(pw)

    def check_password(self, pw):
        return check_password_hash(self.password_hash, pw)


class Ingredient(db.Model):
    __tablename__ = 'ingredients'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), unique=True, nullable=False)


class Tool(db.Model):
    __tablename__ = 'tools'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), unique=True, nullable=False)


class OperationLog(db.Model):
    __tablename__ = 'operation_logs'
    id = db.Column(db.Integer, primary_key=True)
    actor = db.Column(db.String(80), nullable=False)
    action = db.Column(db.String(120), nullable=False)
    dry_run = db.Column(db.Boolean, default=True, nullable=False)
    status = db.Column(db.String(30), default='ok', nullable=False)
    summary = db.Column(db.Text, default='')
    params_json = db.Column(db.Text, default='{}')
    params_hash = db.Column(db.String(64), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    def to_dict(self):
        payload = {}
        try:
            payload = json.loads(self.params_json or '{}')
        except Exception:
            payload = {'raw': self.params_json}
        return {
            'id': self.id,
            'actor': self.actor,
            'action': self.action,
            'dry_run': bool(self.dry_run),
            'status': self.status,
            'summary': self.summary or '',
            'params': payload,
            'params_hash': self.params_hash,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class CustomFieldDef(db.Model):
    __tablename__ = 'custom_field_defs'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    field_type = db.Column(db.String(20), default='text')  # 'text', 'url', 'textarea'
    display_order = db.Column(db.Integer, default=0)
    values = db.relationship('CustomFieldValue', back_populates='field_def', cascade='all, delete-orphan')

    def to_dict(self):
        return {'id': self.id, 'name': self.name, 'field_type': self.field_type, 'display_order': self.display_order}


class CustomFieldValue(db.Model):
    __tablename__ = 'custom_field_values'
    id = db.Column(db.Integer, primary_key=True)
    recipe_id = db.Column(db.Integer, db.ForeignKey('recipes.id'), nullable=False)
    field_def_id = db.Column(db.Integer, db.ForeignKey('custom_field_defs.id'), nullable=False)
    value = db.Column(db.Text, default='')
    recipe = db.relationship('Recipe', back_populates='custom_values')
    field_def = db.relationship('CustomFieldDef', back_populates='values')


class RecipeIngredient(db.Model):
    __tablename__ = 'recipe_ingredients'
    id = db.Column(db.Integer, primary_key=True)
    recipe_id = db.Column(db.Integer, db.ForeignKey('recipes.id'), nullable=False)
    ingredient_id = db.Column(db.Integer, db.ForeignKey('ingredients.id'), nullable=True)
    subrecipe_id = db.Column(db.Integer, db.ForeignKey('recipes.id'), nullable=True)
    amount = db.Column(db.Float)
    unit = db.Column(db.String(50), default='ml')
    order = db.Column(db.Integer, default=0)
    recipe = db.relationship('Recipe', back_populates='recipe_ingredients', foreign_keys=[recipe_id])
    ingredient = db.relationship('Ingredient')
    subrecipe = db.relationship('Recipe', foreign_keys=[subrecipe_id])


class RecipeTool(db.Model):
    __tablename__ = 'recipe_tools'
    id = db.Column(db.Integer, primary_key=True)
    recipe_id = db.Column(db.Integer, db.ForeignKey('recipes.id'), nullable=False)
    tool_id = db.Column(db.Integer, db.ForeignKey('tools.id'), nullable=False)
    recipe = db.relationship('Recipe', back_populates='recipe_tools')
    tool = db.relationship('Tool')


class RecipeGarnish(db.Model):
    __tablename__ = 'recipe_garnishes'
    id = db.Column(db.Integer, primary_key=True)
    recipe_id = db.Column(db.Integer, db.ForeignKey('recipes.id'), nullable=False)
    ingredient_id = db.Column(db.Integer, db.ForeignKey('ingredients.id'), nullable=True)
    garnish_text = db.Column(db.Text, default='')
    order = db.Column(db.Integer, default=0)
    recipe = db.relationship('Recipe', back_populates='recipe_garnishes')
    ingredient = db.relationship('Ingredient')


class Recipe(db.Model):
    __tablename__ = 'recipes'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    category = db.Column(db.String(100), nullable=False, default='Other')
    subtype = db.Column(db.String(100), nullable=True)
    tags = db.Column(db.Text, default='[]')
    score = db.Column(db.Integer, default=0, nullable=False)
    glassware = db.Column(db.String(200), nullable=True)
    procedure = db.Column(db.Text, default='')
    notes = db.Column(db.Text, default='')
    image_filename = db.Column(db.String(256))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    recipe_ingredients = db.relationship(
        'RecipeIngredient', back_populates='recipe',
        foreign_keys='RecipeIngredient.recipe_id',
        cascade='all, delete-orphan',
        order_by='RecipeIngredient.order'
    )
    recipe_tools = db.relationship('RecipeTool', back_populates='recipe', cascade='all, delete-orphan')
    recipe_garnishes = db.relationship('RecipeGarnish', back_populates='recipe', cascade='all, delete-orphan', order_by='RecipeGarnish.order')
    custom_values = db.relationship('CustomFieldValue', back_populates='recipe', cascade='all, delete-orphan')

    def to_dict(self):
        image_url = f'/uploads/{self.image_filename}' if self.image_filename else None
        image_thumb_url = None
        if self.image_filename:
            if self.image_filename.lower().endswith('.gif'):
                image_thumb_url = image_url
            else:
                thumb_name = _thumbnail_filename(self.image_filename)
                thumb_path = os.path.join(app.config['UPLOAD_FOLDER'], thumb_name)
                image_thumb_url = f'/uploads/{thumb_name}' if os.path.exists(thumb_path) else image_url
        if not image_url:
            icon_file = 'bottle.svg' if self.category == 'Ingredient' else choose_glass_icon(self.glassware, self.recipe_tools)
            image_url = f'/static/glass-icons/{icon_file}' if icon_file else None
            image_thumb_url = image_url

        return {
            'id': self.id,
            'name': self.name,
            'glassware': self.glassware,
            'procedure': self.procedure or '',
            'notes': self.notes or '',
            'image_filename': self.image_filename,
            'image_url': image_url,
            'image_thumb_url': image_thumb_url,
            'score': display_score(self.score),
            'ingredients': [
                {
                    'ingredient_id': ri.ingredient_id,
                    'ingredient_name': ri.ingredient.name if ri.ingredient else None,
                    'amount': ri.amount,
                    'unit': ri.unit or 'ml',
                    'order': ri.order,
                    'subrecipe_id': ri.subrecipe_id,
                    'subrecipe_name': ri.subrecipe.name if ri.subrecipe else None,
                }
                for ri in self.recipe_ingredients
            ],
            'category': self.category or 'Other',
            'subtype': self.subtype,
            'tags': parse_tags(self.tags),
            'tools': [
                {
                    'tool_id': rt.tool_id,
                    'tool_name': rt.tool.name,
                }
                for rt in self.recipe_tools
            ],
            'garnishes': [
                {
                    'ingredient_id': rg.ingredient_id,
                    'ingredient_name': rg.ingredient.name if rg.ingredient else None,
                    'garnish_text': rg.garnish_text or '',
                    'order': rg.order,
                }
                for rg in self.recipe_garnishes
            ],
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'custom_fields': {str(cv.field_def_id): cv.value for cv in self.custom_values},
        }


# ── Auth helpers ─────────────────────────────────────────────────────────────

@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not current_user.is_authenticated or current_user.role != 'admin':
            return jsonify({'error': 'Admin access required'}), 403
        return f(*args, **kwargs)
    return decorated


def _parse_bool(value, default=False):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in ('1', 'true', 'yes', 'on')
    return default


def _extract_dry_run(data):
    if isinstance(data, dict):
        if 'dry_run' in data:
            return _parse_bool(data.get('dry_run'), default=True)
        if 'dryRun' in data:
            return _parse_bool(data.get('dryRun'), default=True)
        if 'apply' in data:
            return not _parse_bool(data.get('apply'), default=False)
    for source in (request.args, request.form):
        if 'dry_run' in source:
            return _parse_bool(source.get('dry_run'), default=True)
        if 'dryRun' in source:
            return _parse_bool(source.get('dryRun'), default=True)
        if 'apply' in source:
            return not _parse_bool(source.get('apply'), default=False)
    return True


def _extract_request_data():
    data = request.get_json(silent=True)
    if isinstance(data, dict):
        return data

    # Some clients send JSON bodies on DELETE without Content-Type.
    # Force-parse as a compatibility fallback so apply/dry_run flags are honored.
    forced = request.get_json(silent=True, force=True)
    if isinstance(forced, dict):
        return forced

    return {}


def _normalized_name(value):
    return str(value or '').strip()


def _normalized_key(value):
    return _normalized_name(value).casefold()


def _parse_source_ids(data):
    if not isinstance(data, dict):
        return None, 'source_id must be an integer'

    if 'source_ids' in data:
        source_ids = data.get('source_ids')
        if not isinstance(source_ids, list) or not source_ids:
            return None, 'source_ids must be a non-empty integer array'
        parsed = []
        seen = set()
        for raw in source_ids:
            try:
                sid = int(raw)
            except (TypeError, ValueError):
                return None, 'source_ids must be a non-empty integer array'
            if sid not in seen:
                parsed.append(sid)
                seen.add(sid)
        return parsed, None

    try:
        return [int(data.get('source_id'))], None
    except (TypeError, ValueError):
        return None, 'source_id must be an integer'


def _ingredient_recipe_for_name(name):
    lowered = _normalized_name(name).lower()
    if not lowered:
        return None
    return Recipe.query.filter(
        db.func.lower(Recipe.name) == lowered,
        Recipe.category == 'Ingredient',
    ).order_by(Recipe.id).first()


def _collect_ingredient_repoint_preview(source, target):
    source_name_lower = source.name.lower()
    ingredient_ref_count = RecipeIngredient.query.filter_by(ingredient_id=source.id).count()
    garnish_ref_count = RecipeGarnish.query.filter_by(ingredient_id=source.id).count()
    garnish_text_matches = RecipeGarnish.query.filter(
        db.func.lower(db.func.trim(RecipeGarnish.garnish_text)) == source_name_lower
    ).count()

    source_subrecipe = _ingredient_recipe_for_name(source.name)
    target_subrecipe = _ingredient_recipe_for_name(target.name)
    subrecipe_ref_count = 0
    if source_subrecipe and target_subrecipe and source_subrecipe.id != target_subrecipe.id:
        subrecipe_ref_count = RecipeIngredient.query.filter_by(subrecipe_id=source_subrecipe.id).count()

    return {
        'recipe_ingredient_refs': ingredient_ref_count,
        'recipe_garnish_refs': garnish_ref_count,
        'garnish_text_updates': garnish_text_matches,
        'recipe_subrecipe_refs': subrecipe_ref_count,
    }


def _apply_ingredient_repoint(source, target):
    RecipeIngredient.query.filter_by(ingredient_id=source.id).update({'ingredient_id': target.id})
    RecipeGarnish.query.filter_by(ingredient_id=source.id).update({'ingredient_id': target.id})

    garnish_text_matches = RecipeGarnish.query.filter(
        db.func.lower(db.func.trim(RecipeGarnish.garnish_text)) == source.name.lower()
    ).all()
    for garnish in garnish_text_matches:
        garnish.garnish_text = target.name

    source_subrecipe = _ingredient_recipe_for_name(source.name)
    target_subrecipe = _ingredient_recipe_for_name(target.name)
    if source_subrecipe and target_subrecipe and source_subrecipe.id != target_subrecipe.id:
        RecipeIngredient.query.filter_by(subrecipe_id=source_subrecipe.id).update({'subrecipe_id': target_subrecipe.id})


def _build_operation_summary(action, dry_run, details):
    summary = dict(details or {})
    summary['action'] = action
    summary['dry_run'] = bool(dry_run)
    return summary


def _record_operation(action, dry_run, details, status='ok'):
    params_json = json.dumps(_build_operation_summary(action, dry_run, details), sort_keys=True)
    actor = current_user.username if current_user.is_authenticated else 'system'
    op = OperationLog(
        actor=actor,
        action=action,
        dry_run=bool(dry_run),
        status=status,
        summary=(details or {}).get('summary', ''),
        params_json=params_json,
        params_hash=hashlib.sha256(params_json.encode('utf-8')).hexdigest(),
    )
    db.session.add(op)
    db.session.flush()
    return op


def _ingredient_usage_counts(ingredient_id):
    ingredient_refs = RecipeIngredient.query.filter_by(ingredient_id=ingredient_id).count()
    garnish_refs = RecipeGarnish.query.filter_by(ingredient_id=ingredient_id).count()
    return {'recipe_ingredients': ingredient_refs, 'recipe_garnishes': garnish_refs}


def _tool_usage_count(tool_id):
    return RecipeTool.query.filter_by(tool_id=tool_id).count()


def _normalized_optional_text(value):
    normalized = _normalized_name(value)
    return normalized or None


# ── Frontend ─────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html', asset_version=APP_VERSION)


@app.route('/uploads/<path:filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


# ── API: Auth ─────────────────────────────────────────────────────────────────

@app.route('/api/auth/login', methods=['POST'])
def api_login():
    data = request.get_json() or {}
    username = data.get('username', '')
    password = data.get('password', '')
    user = User.query.filter_by(username=username).first()
    if user and user.check_password(password):
        login_user(user, remember=True)
        return jsonify({'username': user.username, 'role': user.role})
    logger.warning(f"Login failed for username: {username}")
    return jsonify({'error': 'Invalid username or password', 'code': 'AUTH_FAILED'}), 401


@app.route('/api/auth/logout', methods=['POST'])
def api_logout():
    logout_user()
    return jsonify({'ok': True})


@app.route('/api/auth/me')
def api_me():
    if current_user.is_authenticated:
        return jsonify({'username': current_user.username, 'role': current_user.role})
    return jsonify({'error': 'Not authenticated'}), 401


# ── API: Recipes ──────────────────────────────────────────────────────────────

@app.route('/api/recipes', methods=['GET'])
@login_required
def api_recipes():
    recipes = Recipe.query.order_by(Recipe.name).all()
    return jsonify([r.to_dict() for r in recipes])


@app.route('/api/recipes/<int:rid>', methods=['GET'])
@login_required
def api_recipe(rid):
    return jsonify(Recipe.query.get_or_404(rid).to_dict())


@app.route('/api/recipes', methods=['POST'])
@login_required
@admin_required
def api_create_recipe():
    try:
        data = request.get_json()
    except BadRequest as exc:
        logger.warning('Invalid JSON payload for recipe creation: %s', exc)
        return jsonify({'error': 'Invalid JSON payload'}), 400
    if not isinstance(data, dict):
        logger.warning('Unexpected payload type for recipe creation: %s', type(data).__name__)
        return jsonify({'error': 'Invalid JSON object'}), 400

    if not data.get('name', '').strip():
        return jsonify({'error': 'Name is required'}), 400

    category = (data.get('category') or '').strip() or 'Other'
    subtype = (data.get('subtype') or '').strip() or None
    if not category:
        return jsonify({'error': 'Category is required'}), 400
    if subtype and category not in ('Cocktail', 'Other', 'Ingredient'):
        return jsonify({'error': 'Subtype is only allowed for Cocktail, Other, or Ingredient category'}), 400
    if subtype and category in ('Cocktail', 'Other') and subtype not in COCKTAIL_SUBTYPES:
        return jsonify({'error': 'Invalid subtype for Cocktail/Other'}), 400
    if subtype and category == 'Ingredient' and subtype not in INGREDIENT_SUBTYPES:
        return jsonify({'error': 'Invalid subtype for Ingredient'}), 400

    tags = parse_tags(data.get('tags', []))

    recipe = Recipe(
        name=data['name'].strip(),
        category=category,
        subtype=subtype,
        tags=format_tags(tags),
        score=normalize_score(data['score']) if 'score' in data else 0,
        glassware=_normalized_optional_text(data.get('glassware')),
        procedure=data.get('procedure', '').strip(),
        notes=data.get('notes', '').strip(),
        image_filename=data.get('image_filename'),
    )
    db.session.add(recipe)
    db.session.flush()
    _sync_ingredients(recipe, data.get('ingredients', []))
    _sync_tools(recipe, data.get('tools', []))
    _sync_garnishes(recipe, data.get('garnishes', []))
    _sync_custom_fields(recipe, data.get('custom_fields', {}))
    db.session.commit()
    return jsonify(recipe.to_dict()), 201


@app.route('/api/recipes/<int:rid>', methods=['PUT'])
@login_required
@admin_required
def api_update_recipe(rid):
    recipe = Recipe.query.get_or_404(rid)
    try:
        data = request.get_json()
    except BadRequest as exc:
        logger.warning('Invalid JSON payload for recipe update %s: %s', rid, exc)
        return jsonify({'error': 'Invalid JSON payload'}), 400
    if not isinstance(data, dict):
        logger.warning('Unexpected payload type for recipe update %s: %s', rid, type(data).__name__)
        return jsonify({'error': 'Invalid JSON object'}), 400

    recipe.name = data.get('name', recipe.name).strip()
    if 'category' in data:
        category = (data.get('category') or '').strip()
        if not category:
            return jsonify({'error': 'Category is required'}), 400
        recipe.category = category
    if 'subtype' in data:
        subtype = (data.get('subtype') or '').strip() or None
        if subtype and recipe.category not in ('Cocktail', 'Other', 'Ingredient'):
            return jsonify({'error': 'Subtype is only allowed for Cocktail, Other, or Ingredient category'}), 400
        if subtype and recipe.category in ('Cocktail', 'Other') and subtype not in COCKTAIL_SUBTYPES:
            return jsonify({'error': 'Invalid subtype for Cocktail/Other'}), 400
        if subtype and recipe.category == 'Ingredient' and subtype not in INGREDIENT_SUBTYPES:
            return jsonify({'error': 'Invalid subtype for Ingredient'}), 400
        recipe.subtype = subtype
    if 'tags' in data:
        recipe.tags = format_tags(parse_tags(data.get('tags', [])))
    if 'score' in data:
        recipe.score = normalize_score(data['score'], missing_default=recipe.score if recipe.score is not None else 0)
    if 'glassware' in data:
        recipe.glassware = _normalized_optional_text(data.get('glassware'))
    recipe.procedure = data.get('procedure', recipe.procedure or '').strip()
    recipe.notes = data.get('notes', recipe.notes or '').strip()
    if 'image_filename' in data:
        if recipe.image_filename and recipe.image_filename != data['image_filename']:
            _delete_upload_artifacts(recipe.image_filename)
        recipe.image_filename = data['image_filename']
    recipe.updated_at = datetime.utcnow()

    RecipeIngredient.query.filter_by(recipe_id=rid).delete()
    RecipeTool.query.filter_by(recipe_id=rid).delete()
    RecipeGarnish.query.filter_by(recipe_id=rid).delete()
    CustomFieldValue.query.filter_by(recipe_id=rid).delete()
    db.session.flush()
    _sync_ingredients(recipe, data.get('ingredients', []))
    _sync_tools(recipe, data.get('tools', []))
    _sync_garnishes(recipe, data.get('garnishes', []))
    _sync_custom_fields(recipe, data.get('custom_fields', {}))
    db.session.commit()
    return jsonify(recipe.to_dict())


def _normalize_json_text(text):
    if not isinstance(text, str):
        return text
    text = text.replace('\u2018', "'").replace('\u2019', "'")
    text = text.replace('\u201c', '"').replace('\u201d', '"').replace('\u201e', '"').replace('\u201f', '"')
    text = text.replace('\u2013', '-').replace('\u2014', '-')
    text = text.replace('\u00a0', ' ')
    text = re.sub(r',\s*(?=[}\]])', '', text)
    return text


@app.route('/api/bulk-import', methods=['POST'])
@login_required
@admin_required
def api_bulk_import():
    try:
        data = request.get_json()
    except BadRequest:
        raw = request.get_data(as_text=True)
        try:
            cleaned = _normalize_json_text(raw)
            data = json.loads(cleaned)
        except Exception:
            return jsonify({'error': 'Invalid JSON payload'}), 400
    if data is None:
        raw = request.get_data(as_text=True)
        try:
            cleaned = _normalize_json_text(raw)
            data = json.loads(cleaned)
        except Exception:
            return jsonify({'error': 'Invalid JSON payload'}), 400
    if not isinstance(data, list):
        return jsonify({'error': 'Expected a JSON array of recipes'}), 400

    imported = 0
    errors = []

    for i, recipe_data in enumerate(data):
        try:
            if not isinstance(recipe_data, dict):
                errors.append(f'Recipe {i+1}: Invalid format')
                continue
            if not recipe_data.get('name', '').strip():
                errors.append(f'Recipe {i+1}: Name is required')
                continue

            category = (recipe_data.get('category') or 'Other').strip() or 'Other'
            subtype = (recipe_data.get('subtype') or '').strip() or None
            tags = parse_tags(recipe_data.get('tags', []))
            if subtype and category not in ('Cocktail', 'Other', 'Ingredient'):
                errors.append(f'Recipe {i+1}: Subtype is only allowed for Cocktail, Other, or Ingredient category')
                continue
            if subtype and category in ('Cocktail', 'Other') and subtype not in COCKTAIL_SUBTYPES:
                errors.append(f'Recipe {i+1}: Invalid subtype for Cocktail/Other')
                continue
            if subtype and category == 'Ingredient' and subtype not in INGREDIENT_SUBTYPES:
                errors.append(f'Recipe {i+1}: Invalid subtype for Ingredient')
                continue

            score = normalize_score(recipe_data['score']) if 'score' in recipe_data else 0

            recipe = Recipe(
                name=recipe_data['name'].strip(),
                category=category,
                subtype=subtype,
                tags=format_tags(tags),
                score=score,
                glassware=_normalized_optional_text(recipe_data.get('glassware')),
                procedure=recipe_data.get('procedure', '').strip(),
                notes=recipe_data.get('notes', '').strip() if recipe_data.get('notes') else '',
                image_filename=recipe_data.get('image_filename'),
            )
            db.session.add(recipe)
            db.session.flush()
            _sync_ingredients(recipe, recipe_data.get('ingredients', []))
            _sync_tools(recipe, recipe_data.get('tools', []))
            _sync_garnishes(recipe, recipe_data.get('garnishes', []))
            _sync_custom_fields(recipe, recipe_data.get('custom_fields', {}))
            db.session.commit()
            imported += 1
        except Exception as e:
            errors.append(f'Recipe {i+1}: {str(e)}')
            db.session.rollback()
            continue

    return jsonify({'imported': imported, 'errors': errors}), 200 if imported > 0 else 400


@app.route('/api/recipes/<int:rid>', methods=['DELETE'])
@login_required
@admin_required
def api_delete_recipe(rid):
    recipe = Recipe.query.get_or_404(rid)
    if recipe.image_filename:
        _delete_upload_artifacts(recipe.image_filename)
    db.session.delete(recipe)
    db.session.commit()
    return jsonify({'ok': True})


def _sync_tools(recipe, tools_data):
    for tool_item in tools_data:
        tool_id = None
        name = ''
        if isinstance(tool_item, dict):
            tool_id = tool_item.get('tool_id')
            name = (tool_item.get('tool_name') or '').strip()
        else:
            name = (tool_item or '').strip()

        if tool_id is not None and tool_id != '':
            try:
                tool_id = int(tool_id)
            except (TypeError, ValueError):
                tool_id = None

        tool = None
        if tool_id:
            tool = db.session.get(Tool, tool_id)
            if tool and name and tool.name != name:
                # If the tool id points to an existing tool but the user changed the name,
                # link to the tool record with the new name instead of keeping the old tool.
                existing = Tool.query.filter_by(name=name).first()
                if existing:
                    tool = existing
                else:
                    tool = Tool(name=name)
                    db.session.add(tool)
                    db.session.flush()
        if not tool and name:
            tool = Tool.query.filter_by(name=name).first()
        if not tool and name:
            tool = Tool(name=name)
            db.session.add(tool)
            db.session.flush()
        if not tool:
            continue
        db.session.add(RecipeTool(recipe_id=recipe.id, tool_id=tool.id))


def _sync_garnishes(recipe, garnishes_data):
    for i, garnish_item in enumerate(garnishes_data):
        ingredient_id = None
        garnish_text = ''
        if isinstance(garnish_item, dict):
            ingredient_id = garnish_item.get('ingredient_id')
            garnish_text = (garnish_item.get('garnish_text') or '').strip()
        else:
            garnish_text = (garnish_item or '').strip()

        if not garnish_text and ingredient_id is None:
            continue

        if ingredient_id is not None and ingredient_id != '':
            try:
                ingredient_id = int(ingredient_id)
            except (TypeError, ValueError):
                ingredient_id = None

        ingredient = None
        if ingredient_id:
            ingredient = db.session.get(Ingredient, ingredient_id)
        if not ingredient and garnish_text:
            ingredient = Ingredient.query.filter_by(name=garnish_text).first()
        if ingredient:
            ingredient_id = ingredient.id
        else:
            ingredient_id = None

        db.session.add(RecipeGarnish(
            recipe_id=recipe.id,
            ingredient_id=ingredient_id,
            garnish_text=garnish_text,
            order=i,
        ))


def _sync_ingredients(recipe, ingredients_data):
    for i, ing_item in enumerate(ingredients_data):
        ingredient_id = None
        subrecipe_id = None
        name = ''
        amount = None
        unit = 'ml'
        if isinstance(ing_item, dict):
            ingredient_id = ing_item.get('ingredient_id')
            subrecipe_id = ing_item.get('subrecipe_id')
            name = (ing_item.get('ingredient_name') or '').strip()
            amount = ing_item.get('amount')
            unit = (ing_item.get('unit') or 'ml').strip()
        else:
            name = (ing_item or '').strip()

        if ingredient_id is not None and ingredient_id != '':
            try:
                ingredient_id = int(ingredient_id)
            except (TypeError, ValueError):
                ingredient_id = None
        if subrecipe_id is not None and subrecipe_id != '':
            try:
                subrecipe_id = int(subrecipe_id)
            except (TypeError, ValueError):
                subrecipe_id = None

        if subrecipe_id:
            subrecipe = db.session.get(Recipe, subrecipe_id)
            if not subrecipe:
                continue
            ri = RecipeIngredient(
                recipe_id=recipe.id,
                ingredient_id=None,
                subrecipe_id=subrecipe_id,
                amount=amount,
                unit=unit,
                order=i,
            )
            db.session.add(ri)
        else:
            ingredient = None
            if ingredient_id:
                ingredient = db.session.get(Ingredient, ingredient_id)
            if not ingredient and name:
                ingredient = Ingredient.query.filter_by(name=name).first()
            if not ingredient and name:
                ingredient = Ingredient(name=name)
                db.session.add(ingredient)
                db.session.flush()
            if not ingredient:
                continue
            ri = RecipeIngredient(
                recipe_id=recipe.id,
                ingredient_id=ingredient.id,
                subrecipe_id=None,
                amount=amount,
                unit=unit,
                order=i,
            )
            db.session.add(ri)


def _sync_custom_fields(recipe, custom_fields_data):
    """custom_fields_data: dict of {field_def_id_str: value}"""
    for fid_str, value in custom_fields_data.items():
        try:
            fid = int(fid_str)
        except (TypeError, ValueError):
            continue
        if not db.session.get(CustomFieldDef, fid):
            continue
        cv = CustomFieldValue(recipe_id=recipe.id, field_def_id=fid, value=str(value or ''))
        db.session.add(cv)


# ── API: Custom Field Definitions ─────────────────────────────────────────

@app.route('/api/fields', methods=['GET'])
@login_required
def api_fields():
    fields = CustomFieldDef.query.order_by(CustomFieldDef.display_order, CustomFieldDef.id).all()
    return jsonify([f.to_dict() for f in fields])


@app.route('/api/fields', methods=['POST'])
@login_required
@admin_required
def api_create_field():
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Name is required'}), 400
    field_type = data.get('field_type', 'text')
    if field_type not in ('text', 'url', 'textarea'):
        return jsonify({'error': 'Invalid field type'}), 400
    max_order = db.session.query(db.func.max(CustomFieldDef.display_order)).scalar() or 0
    f = CustomFieldDef(name=name, field_type=field_type, display_order=max_order + 1)
    db.session.add(f)
    db.session.commit()
    return jsonify(f.to_dict()), 201


@app.route('/api/fields/<int:fid>', methods=['PUT'])
@login_required
@admin_required
def api_update_field(fid):
    f = CustomFieldDef.query.get_or_404(fid)
    data = request.get_json() or {}
    if 'name' in data:
        name = (data.get('name') or '').strip()
        if not name:
            return jsonify({'error': 'Name is required'}), 400
        f.name = name
    if 'field_type' in data:
        field_type = data.get('field_type')
        if field_type not in ('text', 'url', 'textarea'):
            return jsonify({'error': 'Invalid field type'}), 400
        f.field_type = field_type
    if 'display_order' in data:
        try:
            f.display_order = int(data['display_order'])
        except (TypeError, ValueError):
            return jsonify({'error': 'display_order must be an integer'}), 400
    db.session.commit()
    return jsonify(f.to_dict())


@app.route('/api/fields/<int:fid>', methods=['DELETE'])
@login_required
@admin_required
def api_delete_field(fid):
    f = CustomFieldDef.query.get_or_404(fid)
    db.session.delete(f)
    db.session.commit()
    return jsonify({'ok': True})


# ── API: Tags ─────────────────────────────────────────────────────────────────

@app.route('/api/ingredients')
@login_required
def api_ingredients():
    return jsonify([{'id': i.id, 'name': i.name} for i in Ingredient.query.order_by(Ingredient.name).all()])


@app.route('/api/admin/ingredients', methods=['POST'])
@login_required
@admin_required
def api_admin_create_ingredient():
    data = request.get_json() or {}
    name = _normalized_name(data.get('name'))
    if not name:
        return jsonify({'error': 'Name is required'}), 400
    existing = Ingredient.query.filter(db.func.lower(Ingredient.name) == name.lower()).first()
    if existing:
        return jsonify({'error': 'Ingredient already exists', 'ingredient': {'id': existing.id, 'name': existing.name}}), 409
    ingredient = Ingredient(name=name)
    db.session.add(ingredient)
    op = _record_operation('ingredient.create', dry_run=False, details={'ingredient_name': name, 'summary': f'Created ingredient {name}'})
    db.session.commit()
    return jsonify({'id': ingredient.id, 'name': ingredient.name, 'operation_id': op.id}), 201


@app.route('/api/admin/ingredients/<int:iid>', methods=['PUT', 'PATCH'])
@login_required
@admin_required
def api_admin_rename_ingredient(iid):
    ingredient = Ingredient.query.get_or_404(iid)
    data = request.get_json(silent=True) or {}
    dry_run = _extract_dry_run(data)
    name = _normalized_name(data.get('name')) or _normalized_name(request.values.get('name'))
    if not name:
        return jsonify({'error': 'Name is required'}), 400
    if name == ingredient.name:
        preview = {
            'action': 'ingredient.rename',
            'dry_run': dry_run,
            'current_name': ingredient.name,
            'new_name': name,
            'changed': False,
            'reason': 'No effective change',
        }
        op = _record_operation('ingredient.rename', dry_run=dry_run, details={'summary': 'No-op ingredient rename', **preview})
        db.session.commit()
        return jsonify({**preview, 'operation_id': op.id})

    conflict = Ingredient.query.filter(db.func.lower(Ingredient.name) == name.lower(), Ingredient.id != iid).first()
    if conflict:
        return jsonify({
            'error': 'Target name already exists as another ingredient',
            'conflict': {'id': conflict.id, 'name': conflict.name},
            'hint': 'Use ingredient merge endpoint instead',
        }), 409

    preview = {
        'action': 'ingredient.rename',
        'dry_run': dry_run,
        'ingredient_id': iid,
        'current_name': ingredient.name,
        'new_name': name,
        'changed': True,
    }
    if not dry_run:
        ingredient.name = name
    op = _record_operation('ingredient.rename', dry_run=dry_run, details={'summary': f'Renamed ingredient {ingredient.name} -> {name}', **preview})
    db.session.commit()
    return jsonify({**preview, 'operation_id': op.id})


@app.route('/api/admin/ingredients/<int:iid>', methods=['DELETE'])
@login_required
@admin_required
def api_admin_delete_ingredient(iid):
    ingredient = Ingredient.query.get_or_404(iid)
    data = _extract_request_data()
    dry_run = _extract_dry_run(data)
    if isinstance(data, dict) and 'force' in data:
        force = _parse_bool(data.get('force'), default=False)
    else:
        force = _parse_bool(request.args.get('force'), default=False)
    usage = _ingredient_usage_counts(iid)
    total_refs = usage['recipe_ingredients'] + usage['recipe_garnishes']
    if total_refs > 0 and not force:
        return jsonify({
            'error': 'Ingredient is in use',
            'usage': usage,
            'hint': 'Use force=true only when intentional, or merge into canonical ingredient',
        }), 409

    preview = {
        'action': 'ingredient.delete',
        'dry_run': dry_run,
        'force': force,
        'ingredient': {'id': ingredient.id, 'name': ingredient.name},
        'usage': usage,
        'deleted': total_refs == 0 or force,
    }
    if not dry_run and (total_refs == 0 or force):
        if force:
            RecipeIngredient.query.filter_by(ingredient_id=iid).delete()
            RecipeGarnish.query.filter_by(ingredient_id=iid).delete()
        db.session.delete(ingredient)
    op = _record_operation('ingredient.delete', dry_run=dry_run, details={'summary': f'Delete ingredient {ingredient.name}', **preview})
    db.session.commit()
    return jsonify({**preview, 'operation_id': op.id})


@app.route('/api/admin/ingredients/merge', methods=['POST'])
@login_required
@admin_required
def api_admin_merge_ingredients():
    data = request.get_json() or {}
    dry_run = _extract_dry_run(data)
    source_ids, source_err = _parse_source_ids(data)
    if source_err:
        return jsonify({'error': source_err}), 400
    target_id = data.get('target_id')
    target_name = _normalized_name(data.get('target_name'))

    if target_id is None and not target_name:
        return jsonify({'error': 'Provide target_id or target_name'}), 400

    target = None
    created_target = False
    preview_target_name = None
    if target_id is not None:
        try:
            target_id = int(target_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'target_id must be an integer'}), 400
        target = db.session.get(Ingredient, target_id)
    elif target_name:
        target = Ingredient.query.filter(db.func.lower(Ingredient.name) == target_name.lower()).first()
        if not target:
            preview_target_name = target_name
            if not dry_run:
                target = Ingredient(name=target_name)
                db.session.add(target)
                db.session.flush()
                created_target = True

    if not target and not (dry_run and preview_target_name):
        return jsonify({'error': 'target ingredient not found'}), 404

    sources = []
    source_payload = []
    updates_total = {
        'recipe_ingredient_refs': 0,
        'recipe_garnish_refs': 0,
        'garnish_text_updates': 0,
        'recipe_subrecipe_refs': 0,
    }
    for source_id in source_ids:
        source = db.session.get(Ingredient, source_id)
        if not source:
            return jsonify({'error': f'source ingredient not found: {source_id}'}), 404
        if target and source.id == target.id:
            return jsonify({'error': 'source_id and target_id cannot be the same'}), 400
        sources.append(source)
        source_payload.append({'id': source.id, 'name': source.name})
        source_updates = _collect_ingredient_repoint_preview(source, target if target else Ingredient(name=preview_target_name))
        for key, value in source_updates.items():
            updates_total[key] += value

    preview = {
        'action': 'ingredient.merge',
        'dry_run': dry_run,
        'source': source_payload[0] if len(source_payload) == 1 else None,
        'sources': source_payload,
        'target': {
            'id': target.id if target else None,
            'name': target.name if target else preview_target_name,
        },
        'created_target': created_target or (dry_run and preview_target_name is not None),
        'updates': updates_total,
        'deleted_source': True,
    }

    if not dry_run:
        for source in sources:
            _apply_ingredient_repoint(source, target)
            db.session.delete(source)

    target_label = target.name if target else preview_target_name
    merged_count = len(source_payload)
    summary = f"Merged {merged_count} ingredient(s) -> {target_label}"
    op = _record_operation('ingredient.merge', dry_run=dry_run, details={'summary': summary, **preview})
    db.session.commit()
    return jsonify({**preview, 'operation_id': op.id})


@app.route('/api/admin/ingredients/<int:iid>/replace-with/<int:target_id>', methods=['POST'])
@login_required
@admin_required
def api_admin_replace_ingredient(iid, target_id):
    if iid == target_id:
        return jsonify({'error': 'source and target cannot be the same'}), 400

    source = db.session.get(Ingredient, iid)
    if not source:
        return jsonify({'error': 'source ingredient not found'}), 404
    target = db.session.get(Ingredient, target_id)
    if not target:
        return jsonify({'error': 'target ingredient not found'}), 404

    data = request.get_json(silent=True) or {}
    dry_run = _extract_dry_run(data)
    delete_source = _parse_bool(data.get('delete_source'), default=True)
    updates_preview = _collect_ingredient_repoint_preview(source, target)

    preview = {
        'action': 'ingredient.replace_with',
        'dry_run': dry_run,
        'source': {'id': source.id, 'name': source.name},
        'target': {'id': target.id, 'name': target.name},
        'updates': updates_preview,
        'deleted_source': bool(delete_source),
    }

    if not dry_run:
        _apply_ingredient_repoint(source, target)
        if delete_source:
            db.session.delete(source)

    summary = f"Repointed ingredient {source.name} -> {target.name}"
    op = _record_operation('ingredient.replace_with', dry_run=dry_run, details={'summary': summary, **preview})
    db.session.commit()
    return jsonify({**preview, 'operation_id': op.id})


@app.route('/api/tools')
@login_required
def api_tools():
    return jsonify([{'id': t.id, 'name': t.name} for t in Tool.query.order_by(Tool.name).all()])


@app.route('/api/admin/tools', methods=['POST'])
@login_required
@admin_required
def api_admin_create_tool():
    data = request.get_json() or {}
    name = _normalized_name(data.get('name'))
    if not name:
        return jsonify({'error': 'Name is required'}), 400
    existing = Tool.query.filter(db.func.lower(Tool.name) == name.lower()).first()
    if existing:
        return jsonify({'error': 'Tool already exists', 'tool': {'id': existing.id, 'name': existing.name}}), 409
    tool = Tool(name=name)
    db.session.add(tool)
    op = _record_operation('tool.create', dry_run=False, details={'tool_name': name, 'summary': f'Created tool {name}'})
    db.session.commit()
    return jsonify({'id': tool.id, 'name': tool.name, 'operation_id': op.id}), 201


@app.route('/api/admin/tools/<int:tid>', methods=['PUT', 'PATCH'])
@login_required
@admin_required
def api_admin_rename_tool(tid):
    tool = Tool.query.get_or_404(tid)
    data = request.get_json(silent=True) or {}
    dry_run = _extract_dry_run(data)
    name = _normalized_name(data.get('name')) or _normalized_name(request.values.get('name'))
    if not name:
        return jsonify({'error': 'Name is required'}), 400
    if name == tool.name:
        preview = {
            'action': 'tool.rename',
            'dry_run': dry_run,
            'current_name': tool.name,
            'new_name': name,
            'changed': False,
            'reason': 'No effective change',
        }
        op = _record_operation('tool.rename', dry_run=dry_run, details={'summary': 'No-op tool rename', **preview})
        db.session.commit()
        return jsonify({**preview, 'operation_id': op.id})

    conflict = Tool.query.filter(db.func.lower(Tool.name) == name.lower(), Tool.id != tid).first()
    if conflict:
        return jsonify({
            'error': 'Target name already exists as another tool',
            'conflict': {'id': conflict.id, 'name': conflict.name},
            'hint': 'Use tool merge endpoint instead',
        }), 409

    preview = {
        'action': 'tool.rename',
        'dry_run': dry_run,
        'tool_id': tid,
        'current_name': tool.name,
        'new_name': name,
        'changed': True,
    }
    if not dry_run:
        tool.name = name
    op = _record_operation('tool.rename', dry_run=dry_run, details={'summary': f'Renamed tool {tool.name} -> {name}', **preview})
    db.session.commit()
    return jsonify({**preview, 'operation_id': op.id})


@app.route('/api/admin/tools/<int:tid>', methods=['DELETE'])
@login_required
@admin_required
def api_admin_delete_tool(tid):
    tool = Tool.query.get_or_404(tid)
    data = _extract_request_data()
    dry_run = _extract_dry_run(data)
    if isinstance(data, dict) and 'force' in data:
        force = _parse_bool(data.get('force'), default=False)
    else:
        force = _parse_bool(request.args.get('force'), default=False)
    usage_count = _tool_usage_count(tid)
    if usage_count > 0 and not force:
        return jsonify({
            'error': 'Tool is in use',
            'usage': {'recipe_tools': usage_count},
            'hint': 'Use force=true only when intentional, or merge into canonical tool',
        }), 409

    preview = {
        'action': 'tool.delete',
        'dry_run': dry_run,
        'force': force,
        'tool': {'id': tool.id, 'name': tool.name},
        'usage': {'recipe_tools': usage_count},
        'deleted': usage_count == 0 or force,
    }
    if not dry_run and (usage_count == 0 or force):
        if force:
            RecipeTool.query.filter_by(tool_id=tid).delete()
        db.session.delete(tool)
    op = _record_operation('tool.delete', dry_run=dry_run, details={'summary': f'Delete tool {tool.name}', **preview})
    db.session.commit()
    return jsonify({**preview, 'operation_id': op.id})


@app.route('/api/admin/tools/merge', methods=['POST'])
@login_required
@admin_required
def api_admin_merge_tools():
    data = request.get_json() or {}
    dry_run = _extract_dry_run(data)
    source_ids, source_err = _parse_source_ids(data)
    if source_err:
        return jsonify({'error': source_err}), 400
    target_id = data.get('target_id')
    target_name = _normalized_name(data.get('target_name'))

    if target_id is None and not target_name:
        return jsonify({'error': 'Provide target_id or target_name'}), 400

    target = None
    created_target = False
    preview_target_name = None
    if target_id is not None:
        try:
            target_id = int(target_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'target_id must be an integer'}), 400
        target = db.session.get(Tool, target_id)
    elif target_name:
        target = Tool.query.filter(db.func.lower(Tool.name) == target_name.lower()).first()
        if not target:
            preview_target_name = target_name
            if not dry_run:
                target = Tool(name=target_name)
                db.session.add(target)
                db.session.flush()
                created_target = True

    if not target and not (dry_run and preview_target_name):
        return jsonify({'error': 'target tool not found'}), 404

    source_payload = []
    recipe_tool_refs = 0
    sources = []
    for source_id in source_ids:
        source = db.session.get(Tool, source_id)
        if not source:
            return jsonify({'error': f'source tool not found: {source_id}'}), 404
        if target and source.id == target.id:
            return jsonify({'error': 'source_id and target_id cannot be the same'}), 400
        source_payload.append({'id': source.id, 'name': source.name})
        recipe_tool_refs += RecipeTool.query.filter_by(tool_id=source.id).count()
        sources.append(source)

    preview = {
        'action': 'tool.merge',
        'dry_run': dry_run,
        'source': source_payload[0] if len(source_payload) == 1 else None,
        'sources': source_payload,
        'target': {
            'id': target.id if target else None,
            'name': target.name if target else preview_target_name,
        },
        'created_target': created_target or (dry_run and preview_target_name is not None),
        'updates': {
            'recipe_tool_refs': recipe_tool_refs,
        },
        'deleted_source': True,
    }

    if not dry_run:
        for source in sources:
            RecipeTool.query.filter_by(tool_id=source.id).update({'tool_id': target.id})
            db.session.delete(source)

    target_label = target.name if target else preview_target_name
    merged_count = len(source_payload)
    summary = f"Merged {merged_count} tool(s) -> {target_label}"
    op = _record_operation('tool.merge', dry_run=dry_run, details={'summary': summary, **preview})
    db.session.commit()
    return jsonify({**preview, 'operation_id': op.id})


@app.route('/api/admin/recipes/bulk-update', methods=['POST'])
@login_required
@admin_required
def api_admin_bulk_update_recipes():
    data = request.get_json() or {}
    dry_run = _extract_dry_run(data)
    filters = data.get('filters') or {}
    updates = data.get('updates') or {}

    query = Recipe.query

    recipe_ids = filters.get('recipe_ids')
    if recipe_ids is not None:
        try:
            normalized_ids = [int(rid) for rid in recipe_ids]
        except (TypeError, ValueError):
            return jsonify({'error': 'filters.recipe_ids must be an integer array'}), 400
        query = query.filter(Recipe.id.in_(normalized_ids))

    if filters.get('category'):
        query = query.filter(Recipe.category == str(filters['category']).strip())
    if 'subtype' in filters:
        subtype_filter = filters.get('subtype')
        if subtype_filter is None:
            query = query.filter(Recipe.subtype.is_(None))
        else:
            query = query.filter(Recipe.subtype == str(subtype_filter).strip())

    tag_any = filters.get('tag_any') or []
    tag_values = [str(t).strip() for t in tag_any if str(t).strip()] if isinstance(tag_any, list) else []
    if tag_values:
        query = query.filter(or_(*[Recipe.tags.ilike(f'%"{tag}"%') for tag in tag_values]))

    recipes = query.all()
    apply_all = _parse_bool(filters.get('apply_all'), default=False)
    has_effective_filters = any([
        recipe_ids is not None,
        bool(filters.get('category')),
        'subtype' in filters,
        bool(tag_values),
    ])
    if not apply_all and not has_effective_filters:
        return jsonify({'error': 'Refusing unfiltered bulk update. Set filters.apply_all=true to target all recipes.'}), 400

    if not updates:
        return jsonify({'error': 'updates object is required'}), 400

    tags_add = parse_tags(updates.get('tags_add', []))
    tags_remove = parse_tags(updates.get('tags_remove', []))
    tags_set = updates.get('tags_set')

    category_update = updates.get('category') if 'category' in updates else None
    subtype_update_marker = 'subtype' in updates
    subtype_update = updates.get('subtype') if subtype_update_marker else None

    changed_count = 0
    preview_items = []

    for recipe in recipes:
        new_category = recipe.category
        new_subtype = recipe.subtype
        new_tags = parse_tags(recipe.tags)

        if category_update is not None:
            new_category = str(category_update).strip() or recipe.category
        if subtype_update_marker:
            raw_subtype = subtype_update
            if raw_subtype is None:
                new_subtype = None
            else:
                new_subtype = str(raw_subtype).strip() or None

        if tags_set is not None:
            new_tags = parse_tags(tags_set)
        else:
            for tag in tags_add:
                if tag not in new_tags:
                    new_tags.append(tag)
            if tags_remove:
                remove_keys = {t.casefold() for t in tags_remove}
                new_tags = [t for t in new_tags if t.casefold() not in remove_keys]

        changed = (
            new_category != recipe.category
            or new_subtype != recipe.subtype
            or new_tags != parse_tags(recipe.tags)
        )
        if changed:
            changed_count += 1

        if len(preview_items) < 200:
            preview_items.append({
                'recipe_id': recipe.id,
                'name': recipe.name,
                'changed': changed,
                'before': {'category': recipe.category, 'subtype': recipe.subtype, 'tags': parse_tags(recipe.tags)},
                'after': {'category': new_category, 'subtype': new_subtype, 'tags': new_tags},
            })

        if not dry_run and changed:
            recipe.category = new_category
            recipe.subtype = new_subtype
            recipe.tags = format_tags(new_tags)

    preview = {
        'action': 'recipes.bulk_update',
        'dry_run': dry_run,
        'matched_recipes': len(recipes),
        'changed_recipes': changed_count,
        'filters': filters,
        'updates': updates,
        'items_preview': preview_items,
        'items_preview_truncated': len(recipes) > len(preview_items),
    }
    op = _record_operation(
        'recipes.bulk_update',
        dry_run=dry_run,
        details={'summary': f'Bulk recipe update matched={len(recipes)} changed={changed_count}', **preview},
    )
    db.session.commit()
    return jsonify({**preview, 'operation_id': op.id})


@app.route('/api/admin/operations', methods=['GET'])
@login_required
@admin_required
def api_admin_operations():
    try:
        limit = max(1, min(200, int(request.args.get('limit', 50))))
    except (TypeError, ValueError):
        return jsonify({'error': 'limit must be an integer'}), 400
    rows = OperationLog.query.order_by(OperationLog.id.desc()).limit(limit).all()
    return jsonify([row.to_dict() for row in rows])


# ── API: Image Upload ─────────────────────────────────────────────────────────

@app.route('/api/upload', methods=['POST'])
@login_required
@admin_required
def api_upload():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    f = request.files['file']
    if not f.filename:
        return jsonify({'error': 'Empty filename'}), 400
    ext = f.filename.rsplit('.', 1)[-1].lower() if '.' in f.filename else ''
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({'error': f'File type .{ext} not allowed'}), 400
    ts = datetime.utcnow().strftime('%Y%m%d_%H%M%S_%f')
    base_name = secure_filename(os.path.splitext(f.filename)[0]) or 'upload'

    # Keep GIF uploads as-is to preserve animation.
    if ext == 'gif':
        filename = secure_filename(f'{ts}_{base_name}.gif')
        f.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
        gif_url = f'/uploads/{filename}'
        return jsonify({'filename': filename, 'url': gif_url, 'thumb_url': gif_url})

    filename = secure_filename(f'{ts}_{base_name}.webp')
    thumb_filename = _thumbnail_filename(filename)
    output_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    thumb_output_path = os.path.join(app.config['UPLOAD_FOLDER'], thumb_filename)
    try:
        _optimize_and_save_upload(f, output_path, thumb_output_path)
    except (UnidentifiedImageError, OSError):
        return jsonify({'error': 'Invalid or unsupported image file'}), 400

    return jsonify({'filename': filename, 'url': f'/uploads/{filename}', 'thumb_url': f'/uploads/{thumb_filename}'})


# ── Bootstrap ─────────────────────────────────────────────────────────────────

@app.errorhandler(Exception)
def handle_api_exceptions(error):
    if request.path.startswith('/api/'):
        if isinstance(error, HTTPException):
            return jsonify({'error': error.description}), error.code
        return jsonify({'error': str(error)}), 500
    raise error

with app.app_context():
    db.create_all()
    recipe_columns = [c['name'] for c in db.inspect(db.engine).get_columns('recipes')]
    if 'score' not in recipe_columns:
        db.session.execute(text('ALTER TABLE recipes ADD COLUMN score INTEGER DEFAULT 0'))
        db.session.execute(text('UPDATE recipes SET score=0 WHERE score IS NULL'))
        db.session.commit()
    else:
        # Legacy ingredient recipes were auto-created with a default score of 5.
        # Normalize those to unrated so Ingredient records don't imply a rating.
        has_legacy_ingredient_scores = db.session.execute(text(
            "SELECT 1 FROM recipes WHERE category='Ingredient' AND score=5 LIMIT 1"
        )).first()
        if has_legacy_ingredient_scores:
            db.session.execute(text("UPDATE recipes SET score=0 WHERE category='Ingredient' AND score=5"))
            db.session.commit()
    if 'category' not in recipe_columns:
        db.session.execute(text("ALTER TABLE recipes ADD COLUMN category VARCHAR(100) DEFAULT 'Other'"))
        db.session.commit()
    if 'subtype' not in recipe_columns:
        db.session.execute(text('ALTER TABLE recipes ADD COLUMN subtype VARCHAR(100)'))
        db.session.commit()
    if 'tags' not in recipe_columns:
        db.session.execute(text("ALTER TABLE recipes ADD COLUMN tags TEXT DEFAULT '[]'"))
        db.session.commit()
    if 'glassware' not in recipe_columns:
        db.session.execute(text('ALTER TABLE recipes ADD COLUMN glassware VARCHAR(200)'))
        db.session.commit()
    ri_columns = db.inspect(db.engine).get_columns('recipe_ingredients')
    columns = [c['name'] for c in ri_columns]
    if 'subrecipe_id' not in columns:
        db.session.execute(text('ALTER TABLE recipe_ingredients ADD COLUMN subrecipe_id INTEGER'))
        db.session.commit()
        ri_columns = db.inspect(db.engine).get_columns('recipe_ingredients')

    ingredient_col = next((c for c in ri_columns if c['name'] == 'ingredient_id'), None)
    if ingredient_col and not ingredient_col.get('nullable', True):
        logger.info('Migrating recipe_ingredients: making ingredient_id nullable for subrecipe rows')
        db.session.execute(text('PRAGMA foreign_keys=OFF'))
        db.session.execute(text(
            '''
            CREATE TABLE recipe_ingredients_new (
                id INTEGER NOT NULL PRIMARY KEY,
                recipe_id INTEGER NOT NULL,
                ingredient_id INTEGER,
                subrecipe_id INTEGER,
                amount FLOAT,
                unit VARCHAR(50) DEFAULT 'ml',
                "order" INTEGER DEFAULT 0,
                FOREIGN KEY(recipe_id) REFERENCES recipes (id),
                FOREIGN KEY(ingredient_id) REFERENCES ingredients (id),
                FOREIGN KEY(subrecipe_id) REFERENCES recipes (id)
            )
            '''
        ))
        db.session.execute(text(
            '''
            INSERT INTO recipe_ingredients_new (id, recipe_id, ingredient_id, subrecipe_id, amount, unit, "order")
            SELECT id, recipe_id, ingredient_id, subrecipe_id, amount, unit, "order"
            FROM recipe_ingredients
            '''
        ))
        db.session.execute(text('DROP TABLE recipe_ingredients'))
        db.session.execute(text('ALTER TABLE recipe_ingredients_new RENAME TO recipe_ingredients'))
        db.session.execute(text('PRAGMA foreign_keys=ON'))
        db.session.commit()

    if 'classification' in recipe_columns:
        rows = db.session.execute(text('SELECT id, classification FROM recipes')).fetchall()
        for rid, classification in rows:
            if not classification:
                continue
            category, subtype = map_legacy_classification(classification)
            db.session.execute(
                text('UPDATE recipes SET category = :category, subtype = :subtype WHERE id = :id'),
                {'category': category or 'Other', 'subtype': subtype, 'id': rid}
            )
        db.session.commit()

    db.session.execute(text(
        """
        UPDATE recipes
        SET category = 'Cocktail',
            subtype = CASE
                WHEN subtype IS NULL OR TRIM(subtype) = '' THEN 'Daisy'
                ELSE subtype
            END
        WHERE category = 'Daisy'
        """
    ))
    db.session.commit()

    backfilled_glassware = 0
    recipes_missing_glassware = Recipe.query.filter(
        or_(Recipe.glassware.is_(None), db.func.trim(Recipe.glassware) == '')
    ).all()
    for recipe in recipes_missing_glassware:
        inferred_glassware = infer_glassware_name_from_tools(recipe.recipe_tools)
        if not inferred_glassware:
            continue
        recipe.glassware = inferred_glassware
        backfilled_glassware += 1
    if backfilled_glassware:
        logger.info('Backfilled glassware on %s recipes from legacy tools data', backfilled_glassware)
        db.session.commit()

    def _seed(username_env, password_env, default_u, default_p, role):
        uname = os.environ.get(username_env, default_u)
        passwd = os.environ.get(password_env, default_p)
        logger.info(f"Syncing user '{uname}' with password from env var '{password_env}'")
        u = User.query.filter_by(username=uname).first()
        if not u:
            logger.info(f"Creating new user '{uname}' with role '{role}'")
            u = User(username=uname, role=role)
            db.session.add(u)
        else:
            logger.info(f"User '{uname}' exists, updating password")
        # Always sync password from environment variables
        u.set_password(passwd)
        db.session.add(u)  # Ensure user is tracked for updates

    _seed('ADMIN_USERNAME', 'ADMIN_PASSWORD', 'admin', 'cocktails_admin', 'admin')
    _seed('USER_USERNAME', 'USER_PASSWORD', 'user', 'cocktails_guest', 'user')
    db.session.commit()
    logger.info("User sync complete")


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
