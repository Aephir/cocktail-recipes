import os
import tempfile
import unittest
from uuid import uuid4

_db_fd, _db_path = tempfile.mkstemp(prefix='cocktail-recipes-test-', suffix='.db')
os.close(_db_fd)
_upload_dir = tempfile.mkdtemp(prefix='cocktail-recipes-test-uploads-')
os.environ['DATABASE_URL'] = f'sqlite:///{_db_path}'
os.environ['UPLOAD_FOLDER'] = _upload_dir
os.environ.setdefault('SECRET_KEY', 'test-secret')

from app import app  # noqa: E402


class AdminIngredientApplyRegressionTest(unittest.TestCase):
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

    def test_admin_create_rename_delete_ingredient_apply_changes_are_visible_in_get(self):
        unique = uuid4().hex[:10]
        initial_name = f'Apply Test Ingredient {unique}'
        renamed_name = f'Apply Test Ingredient Renamed {unique}'

        create_resp = self.client.post('/api/admin/ingredients', json={'name': initial_name, 'apply': True})
        self.assertEqual(create_resp.status_code, 201, create_resp.get_data(as_text=True))
        created = create_resp.get_json()
        ingredient_id = created['id']

        list_after_create = self.client.get('/api/ingredients')
        self.assertEqual(list_after_create.status_code, 200)
        created_names = {item['name'] for item in list_after_create.get_json()}
        self.assertIn(initial_name, created_names)

        rename_resp = self.client.patch(
            f'/api/admin/ingredients/{ingredient_id}',
            json={'name': renamed_name, 'apply': True},
        )
        self.assertEqual(rename_resp.status_code, 200, rename_resp.get_data(as_text=True))
        renamed_payload = rename_resp.get_json()
        self.assertFalse(renamed_payload['dry_run'])

        list_after_rename = self.client.get('/api/ingredients')
        self.assertEqual(list_after_rename.status_code, 200)
        renamed_names = {item['name'] for item in list_after_rename.get_json()}
        self.assertIn(renamed_name, renamed_names)
        self.assertNotIn(initial_name, renamed_names)

        delete_resp = self.client.delete(
            f'/api/admin/ingredients/{ingredient_id}',
            json={'apply': True},
        )
        self.assertEqual(delete_resp.status_code, 200, delete_resp.get_data(as_text=True))
        deleted_payload = delete_resp.get_json()
        self.assertFalse(deleted_payload['dry_run'])
        self.assertTrue(deleted_payload['deleted'])

        list_after_delete = self.client.get('/api/ingredients')
        self.assertEqual(list_after_delete.status_code, 200)
        deleted_names = {item['name'] for item in list_after_delete.get_json()}
        self.assertNotIn(renamed_name, deleted_names)


if __name__ == '__main__':
    unittest.main()
