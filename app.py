from flask import Flask, request, jsonify, send_from_directory, render_template
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import text
import json
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.exceptions import HTTPException, BadRequest
import re
from werkzeug.utils import secure_filename
from werkzeug.middleware.proxy_fix import ProxyFix
import os

CLASSIFICATION_CATEGORIES = [
    'Cocktail', 'Highball', 'Collins', 'Rickey', 'Buck', 'Fizz', 'Julep',
    'Smash', 'Cobbler', 'Swizzle', 'Sling', 'Toddy', 'Punch', 'Cup', 'Flip',
    'Nog', 'Fix', 'Crusta', 'Frappé', 'Shrub', 'Wassail Bowl',
    'Champerelle', 'Other', 'Ingredient',
]
COCKTAIL_SUBTYPES = ['Sour', 'Aromatic', 'Old-Fashioned', 'Improved', 'Daisy']
INGREDIENT_SUBTYPES = ['Base', 'Modifier', 'Special Flavoring', 'Garnish', 'Other']

GLASS_ICON_LOOKUP = [
    (['champagne saucer', 'champagne glass', 'saucer'], 'glass-champagne-saucer-size.svg'),
    (['collins'], 'glass-collins-size.svg'),
    (['highball'], 'glass-highball-size.svg'),
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


def choose_glass_icon(tools):
    tool_names = [normalize_tool_name(tool.tool.name) for tool in tools]
    for aliases, filename in GLASS_ICON_LOOKUP:
        for alias in aliases:
            normalized_alias = normalize_tool_name(alias)
            for tool_name in tool_names:
                if normalized_alias and normalized_alias in tool_name:
                    return filename
    return None


def format_tags(tags):
    return json.dumps([str(t).strip() for t in (tags or []) if str(t).strip()])


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
# app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)  # Removed as app is accessed directly

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
    score = db.Column(db.Integer, default=5, nullable=False)
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
        if not image_url:
            icon_file = 'bottle.svg' if self.category == 'Ingredient' else choose_glass_icon(self.recipe_tools)
            image_url = f'/static/glass-icons/{icon_file}' if icon_file else None

        return {
            'id': self.id,
            'name': self.name,
            'procedure': self.procedure or '',
            'notes': self.notes or '',
            'image_filename': self.image_filename,
            'image_url': image_url,
            'score': self.score,
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


# ── Frontend ─────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


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
    if subtype and category not in ('Cocktail', 'Ingredient'):
        return jsonify({'error': 'Subtype is only allowed for Cocktail or Ingredient category'}), 400
    if subtype and category == 'Cocktail' and subtype not in COCKTAIL_SUBTYPES:
        return jsonify({'error': 'Invalid subtype for Cocktail'}), 400
    if subtype and category == 'Ingredient' and subtype not in INGREDIENT_SUBTYPES:
        return jsonify({'error': 'Invalid subtype for Ingredient'}), 400

    tags = parse_tags(data.get('tags', []))

    recipe = Recipe(
        name=data['name'].strip(),
        category=category,
        subtype=subtype,
        tags=format_tags(tags),
        score=int(data.get('score', 5)) if str(data.get('score', '')).strip() != '' else 5,
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
        if subtype and recipe.category not in ('Cocktail', 'Ingredient'):
            return jsonify({'error': 'Subtype is only allowed for Cocktail or Ingredient category'}), 400
        if subtype and recipe.category == 'Cocktail' and subtype not in COCKTAIL_SUBTYPES:
            return jsonify({'error': 'Invalid subtype for Cocktail'}), 400
        if subtype and recipe.category == 'Ingredient' and subtype not in INGREDIENT_SUBTYPES:
            return jsonify({'error': 'Invalid subtype for Ingredient'}), 400
        recipe.subtype = subtype
    if 'tags' in data:
        recipe.tags = format_tags(parse_tags(data.get('tags', [])))
    if 'score' in data:
        try:
            recipe.score = int(data['score'])
        except (TypeError, ValueError):
            recipe.score = recipe.score
        recipe.score = max(1, min(10, recipe.score))
    recipe.procedure = data.get('procedure', recipe.procedure or '').strip()
    recipe.notes = data.get('notes', recipe.notes or '').strip()
    if 'image_filename' in data:
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
            if subtype and category not in ('Cocktail', 'Ingredient'):
                errors.append(f'Recipe {i+1}: Subtype is only allowed for Cocktail or Ingredient category')
                continue
            if subtype and category == 'Cocktail' and subtype not in COCKTAIL_SUBTYPES:
                errors.append(f'Recipe {i+1}: Invalid subtype for Cocktail')
                continue
            if subtype and category == 'Ingredient' and subtype not in INGREDIENT_SUBTYPES:
                errors.append(f'Recipe {i+1}: Invalid subtype for Ingredient')
                continue

            raw_score = recipe_data.get('score', 5)
            try:
                score = int(raw_score) if str(raw_score).strip() != '' else 5
            except (TypeError, ValueError):
                score = 5
            score = max(1, min(10, score))

            recipe = Recipe(
                name=recipe_data['name'].strip(),
                category=category,
                subtype=subtype,
                tags=format_tags(tags),
                score=score,
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
            tool = Tool.query.get(tool_id)
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
            ingredient = Ingredient.query.get(ingredient_id)
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
            subrecipe = Recipe.query.get(subrecipe_id)
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
                ingredient = Ingredient.query.get(ingredient_id)
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
        if not CustomFieldDef.query.get(fid):
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
        f.name = data['name'].strip()
    if 'field_type' in data and data['field_type'] in ('text', 'url', 'textarea'):
        f.field_type = data['field_type']
    if 'display_order' in data:
        f.display_order = int(data['display_order'])
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


@app.route('/api/tools')
@login_required
def api_tools():
    return jsonify([{'id': t.id, 'name': t.name} for t in Tool.query.order_by(Tool.name).all()])


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
    ts = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
    filename = secure_filename(f'{ts}_{f.filename}')
    f.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
    return jsonify({'filename': filename, 'url': f'/uploads/{filename}'})


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
        db.session.execute(text('ALTER TABLE recipes ADD COLUMN score INTEGER DEFAULT 5'))
        db.session.execute(text('UPDATE recipes SET score=5 WHERE score IS NULL'))
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
    columns = [c['name'] for c in db.inspect(db.engine).get_columns('recipe_ingredients')]
    if 'subrecipe_id' not in columns:
        db.session.execute(text('ALTER TABLE recipe_ingredients ADD COLUMN subrecipe_id INTEGER'))
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
    _seed('USER_USERNAME', 'USER_PASSWORD', 'guest', 'cocktails_guest', 'user')
    db.session.commit()
    logger.info("User sync complete")


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
