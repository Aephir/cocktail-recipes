import os
import tempfile
import unittest
from uuid import uuid4

_db_fd, _db_path = tempfile.mkstemp(prefix='cocktail-recipes-test-glassware-', suffix='.db')
os.close(_db_fd)
_upload_dir = tempfile.mkdtemp(prefix='cocktail-recipes-test-uploads-glassware-')
os.environ['DATABASE_URL'] = f'sqlite:///{_db_path}'
os.environ['UPLOAD_FOLDER'] = _upload_dir
os.environ.setdefault('SECRET_KEY', 'test-secret')

from app import app, db  # noqa: E402


class GlasswareFieldTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app.config['TESTING'] = True
        cls.client = app.test_client()
        resp = cls.client.post(
            '/api/auth/login',
            json={'username': 'admin', 'password': 'cocktails_admin'},
        )
        if resp.status_code != 200:
            raise RuntimeError(f'Failed to log in as admin for tests: {resp.status_code} {resp.get_data(as_text=True)}')

    @classmethod
    def tearDownClass(cls):
        with app.app_context():
            db.session.remove()
            db.engine.dispose()

    def test_recipe_create_persists_glassware_and_uses_icon(self):
        unique = uuid4().hex[:10]
        payload = {
            'name': f'Glassware Test {unique}',
            'category': 'Cocktail',
            'subtype': 'Aromatic',
            'glassware': 'Whisky tumbler',
            'tools': [{'tool_name': 'bar spoon'}],
            'ingredients': [],
            'garnishes': [],
            'procedure': 'Build over ice.',
            'notes': '',
        }

        create_resp = self.client.post('/api/recipes', json=payload)
        self.assertEqual(create_resp.status_code, 201, create_resp.get_data(as_text=True))
        created = create_resp.get_json()

        self.assertEqual(created['glassware'], 'Whisky tumbler')
        self.assertTrue(created['image_url'].endswith('/glass-old-fashioned-size.svg'))

    def test_recipe_without_glassware_still_uses_legacy_tool_alias_for_icon(self):
        unique = uuid4().hex[:10]
        payload = {
            'name': f'Legacy Tool Glass Alias {unique}',
            'category': 'Cocktail',
            'subtype': 'Sour',
            'glassware': None,
            'tools': [{'tool_name': 'Nick & Nora glass'}],
            'ingredients': [],
            'garnishes': [],
            'procedure': 'Shake and strain.',
            'notes': '',
        }

        create_resp = self.client.post('/api/recipes', json=payload)
        self.assertEqual(create_resp.status_code, 201, create_resp.get_data(as_text=True))
        created = create_resp.get_json()

        self.assertIsNone(created['glassware'])
        self.assertTrue(created['image_url'].endswith('/glass-nick-and-nora-size.svg'))


if __name__ == '__main__':
    unittest.main()
