from flask import Flask, request, jsonify, send_from_directory, render_template
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from werkzeug.middleware.proxy_fix import ProxyFix
import os
from datetime import datetime, timedelta
from functools import wraps

app = Flask(__name__)
# app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)  # Removed as app is accessed directly

app.config.update(
    SECRET_KEY=os.environ.get('SECRET_KEY', 'dev-secret-CHANGE-THIS'),
    SQLALCHEMY_DATABASE_URI=os.environ.get('DATABASE_URL', 'sqlite:////data/cocktails.db'),
    UPLOAD_FOLDER=os.environ.get('UPLOAD_FOLDER', '/data/uploads'),
    MAX_CONTENT_LENGTH=32 * 1024 * 1024,
    SQLALCHEMY_TRACK_MODIFICATIONS=False,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE=None,
    SESSION_COOKIE_SECURE=False,
    REMEMBER_COOKIE_DURATION=timedelta(days=60),
    REMEMBER_COOKIE_HTTPONLY=True,
    REMEMBER_COOKIE_SAMESITE=None,
    REMEMBER_COOKIE_SECURE=False,
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
    ingredient_id = db.Column(db.Integer, db.ForeignKey('ingredients.id'), nullable=False)
    amount = db.Column(db.Float)
    unit = db.Column(db.String(50), default='ml')
    order = db.Column(db.Integer, default=0)
    recipe = db.relationship('Recipe', back_populates='recipe_ingredients')
    ingredient = db.relationship('Ingredient')


class RecipeTool(db.Model):
    __tablename__ = 'recipe_tools'
    id = db.Column(db.Integer, primary_key=True)
    recipe_id = db.Column(db.Integer, db.ForeignKey('recipes.id'), nullable=False)
    tool_id = db.Column(db.Integer, db.ForeignKey('tools.id'), nullable=False)
    recipe = db.relationship('Recipe', back_populates='recipe_tools')
    tool = db.relationship('Tool')


class Recipe(db.Model):
    __tablename__ = 'recipes'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    procedure = db.Column(db.Text, default='')
    notes = db.Column(db.Text, default='')
    image_filename = db.Column(db.String(256))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    recipe_ingredients = db.relationship(
        'RecipeIngredient', back_populates='recipe',
        cascade='all, delete-orphan',
        order_by='RecipeIngredient.order'
    )
    recipe_tools = db.relationship('RecipeTool', back_populates='recipe', cascade='all, delete-orphan')
    custom_values = db.relationship('CustomFieldValue', back_populates='recipe', cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'procedure': self.procedure or '',
            'notes': self.notes or '',
            'image_filename': self.image_filename,
            'image_url': f'/uploads/{self.image_filename}' if self.image_filename else None,
            'ingredients': [
                {
                    'name': ri.ingredient.name,
                    'amount': ri.amount,
                    'unit': ri.unit or 'ml',
                    'order': ri.order,
                }
                for ri in self.recipe_ingredients
            ],
            'tools': [rt.tool.name for rt in self.recipe_tools],
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
    user = User.query.filter_by(username=data.get('username', '')).first()
    if user and user.check_password(data.get('password', '')):
        login_user(user, remember=True)
        return jsonify({'username': user.username, 'role': user.role})
    return jsonify({'error': 'Invalid username or password'}), 401


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
    data = request.get_json() or {}
    if not data.get('name', '').strip():
        return jsonify({'error': 'Name is required'}), 400

    recipe = Recipe(
        name=data['name'].strip(),
        procedure=data.get('procedure', '').strip(),
        notes=data.get('notes', '').strip(),
        image_filename=data.get('image_filename'),
    )
    db.session.add(recipe)
    db.session.flush()
    _sync_ingredients(recipe, data.get('ingredients', []))
    _sync_tools(recipe, data.get('tools', []))
    _sync_custom_fields(recipe, data.get('custom_fields', {}))
    db.session.commit()
    return jsonify(recipe.to_dict()), 201


@app.route('/api/recipes/<int:rid>', methods=['PUT'])
@login_required
@admin_required
def api_update_recipe(rid):
    recipe = Recipe.query.get_or_404(rid)
    data = request.get_json() or {}

    recipe.name = data.get('name', recipe.name).strip()
    recipe.procedure = data.get('procedure', recipe.procedure or '').strip()
    recipe.notes = data.get('notes', recipe.notes or '').strip()
    if 'image_filename' in data:
        recipe.image_filename = data['image_filename']
    recipe.updated_at = datetime.utcnow()

    RecipeIngredient.query.filter_by(recipe_id=rid).delete()
    RecipeTool.query.filter_by(recipe_id=rid).delete()
    CustomFieldValue.query.filter_by(recipe_id=rid).delete()
    db.session.flush()
    _sync_ingredients(recipe, data.get('ingredients', []))
    _sync_tools(recipe, data.get('tools', []))
    _sync_custom_fields(recipe, data.get('custom_fields', {}))
    db.session.commit()
    return jsonify(recipe.to_dict())


@app.route('/api/recipes/<int:rid>', methods=['DELETE'])
@login_required
@admin_required
def api_delete_recipe(rid):
    recipe = Recipe.query.get_or_404(rid)
    db.session.delete(recipe)
    db.session.commit()
    return jsonify({'ok': True})


def _sync_ingredients(recipe, ingredients_data):
    for i, ing in enumerate(ingredients_data):
        name = (ing.get('name') or '').strip()
        if not name:
            continue
        ingredient = Ingredient.query.filter_by(name=name).first()
        if not ingredient:
            ingredient = Ingredient(name=name)
            db.session.add(ingredient)
            db.session.flush()
        amount = ing.get('amount')
        if amount is not None:
            try:
                amount = float(amount)
            except (TypeError, ValueError):
                amount = None
        ri = RecipeIngredient(
            recipe_id=recipe.id,
            ingredient_id=ingredient.id,
            amount=amount,
            unit=(ing.get('unit') or 'ml').strip(),
            order=i,
        )
        db.session.add(ri)


def _sync_tools(recipe, tools_data):
    for tool_name in tools_data:
        name = (tool_name if isinstance(tool_name, str) else tool_name.get('name', '')).strip()
        if not name:
            continue
        tool = Tool.query.filter_by(name=name).first()
        if not tool:
            tool = Tool(name=name)
            db.session.add(tool)
            db.session.flush()
        db.session.add(RecipeTool(recipe_id=recipe.id, tool_id=tool.id))


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
    return jsonify([i.name for i in Ingredient.query.order_by(Ingredient.name).all()])


@app.route('/api/tools')
@login_required
def api_tools():
    return jsonify([t.name for t in Tool.query.order_by(Tool.name).all()])


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

with app.app_context():
    db.create_all()

    def _seed(username_env, password_env, default_u, default_p, role):
        uname = os.environ.get(username_env, default_u)
        passwd = os.environ.get(password_env, default_p)
        u = User.query.filter_by(username=uname).first()
        if not u:
            u = User(username=uname, role=role)
            db.session.add(u)
        # Always sync password from environment variables
        u.set_password(passwd)

    _seed('ADMIN_USERNAME', 'ADMIN_PASSWORD', 'admin', 'cocktails_admin', 'admin')
    _seed('USER_USERNAME', 'USER_PASSWORD', 'guest', 'cocktails_guest', 'user')
    db.session.commit()


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
