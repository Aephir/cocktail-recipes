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

    def test_admin_ingredient_rename_honors_dry_run_and_apply(self):
        unique = uuid4().hex[:10]
        initial_name = f'Dry Run Ingredient {unique}'
        dry_run_name = f'Dry Run Ingredient Preview {unique}'
        applied_name = f'Dry Run Ingredient Applied {unique}'

        create_resp = self.client.post('/api/admin/ingredients', json={'name': initial_name})
        self.assertEqual(create_resp.status_code, 201, create_resp.get_data(as_text=True))
        ingredient_id = create_resp.get_json()['id']

        dry_run_resp = self.client.patch(
            f'/api/admin/ingredients/{ingredient_id}',
            json={'name': dry_run_name, 'dry_run': True},
        )
        self.assertEqual(dry_run_resp.status_code, 200, dry_run_resp.get_data(as_text=True))
        dry_run_payload = dry_run_resp.get_json()
        self.assertTrue(dry_run_payload['dry_run'])

        list_after_dry_run = self.client.get('/api/ingredients')
        self.assertEqual(list_after_dry_run.status_code, 200)
        names_after_dry_run = {item['name'] for item in list_after_dry_run.get_json()}
        self.assertIn(initial_name, names_after_dry_run)
        self.assertNotIn(dry_run_name, names_after_dry_run)

        apply_resp = self.client.patch(
            f'/api/admin/ingredients/{ingredient_id}',
            json={'name': applied_name, 'dry_run': False},
        )
        self.assertEqual(apply_resp.status_code, 200, apply_resp.get_data(as_text=True))
        apply_payload = apply_resp.get_json()
        self.assertFalse(apply_payload['dry_run'])

        list_after_apply = self.client.get('/api/ingredients')
        self.assertEqual(list_after_apply.status_code, 200)
        names_after_apply = {item['name'] for item in list_after_apply.get_json()}
        self.assertIn(applied_name, names_after_apply)
        self.assertNotIn(initial_name, names_after_apply)

    def test_admin_ingredient_delete_honors_dry_run_and_apply(self):
        unique = uuid4().hex[:10]
        ingredient_name = f'Delete Ingredient {unique}'

        create_resp = self.client.post('/api/admin/ingredients', json={'name': ingredient_name})
        self.assertEqual(create_resp.status_code, 201, create_resp.get_data(as_text=True))
        ingredient_id = create_resp.get_json()['id']

        dry_run_resp = self.client.delete(
            f'/api/admin/ingredients/{ingredient_id}',
            json={'dry_run': True},
        )
        self.assertEqual(dry_run_resp.status_code, 200, dry_run_resp.get_data(as_text=True))
        dry_run_payload = dry_run_resp.get_json()
        self.assertTrue(dry_run_payload['dry_run'])
        self.assertTrue(dry_run_payload['deleted'])

        list_after_dry_run = self.client.get('/api/ingredients')
        self.assertEqual(list_after_dry_run.status_code, 200)
        names_after_dry_run = {item['name'] for item in list_after_dry_run.get_json()}
        self.assertIn(ingredient_name, names_after_dry_run)

        apply_resp = self.client.delete(
            f'/api/admin/ingredients/{ingredient_id}',
            json={'dry_run': False},
        )
        self.assertEqual(apply_resp.status_code, 200, apply_resp.get_data(as_text=True))
        apply_payload = apply_resp.get_json()
        self.assertFalse(apply_payload['dry_run'])
        self.assertTrue(apply_payload['deleted'])

        list_after_apply = self.client.get('/api/ingredients')
        self.assertEqual(list_after_apply.status_code, 200)
        names_after_apply = {item['name'] for item in list_after_apply.get_json()}
        self.assertNotIn(ingredient_name, names_after_apply)

    def test_admin_tool_rename_honors_dry_run_and_apply(self):
        unique = uuid4().hex[:10]
        initial_name = f'Dry Run Tool {unique}'
        dry_run_name = f'Dry Run Tool Preview {unique}'
        applied_name = f'Dry Run Tool Applied {unique}'

        create_resp = self.client.post('/api/admin/tools', json={'name': initial_name})
        self.assertEqual(create_resp.status_code, 201, create_resp.get_data(as_text=True))
        tool_id = create_resp.get_json()['id']

        dry_run_resp = self.client.patch(
            f'/api/admin/tools/{tool_id}',
            json={'name': dry_run_name, 'dry_run': True},
        )
        self.assertEqual(dry_run_resp.status_code, 200, dry_run_resp.get_data(as_text=True))
        dry_run_payload = dry_run_resp.get_json()
        self.assertTrue(dry_run_payload['dry_run'])

        list_after_dry_run = self.client.get('/api/tools')
        self.assertEqual(list_after_dry_run.status_code, 200)
        names_after_dry_run = {item['name'] for item in list_after_dry_run.get_json()}
        self.assertIn(initial_name, names_after_dry_run)
        self.assertNotIn(dry_run_name, names_after_dry_run)

        apply_resp = self.client.patch(
            f'/api/admin/tools/{tool_id}',
            json={'name': applied_name, 'dry_run': False},
        )
        self.assertEqual(apply_resp.status_code, 200, apply_resp.get_data(as_text=True))
        apply_payload = apply_resp.get_json()
        self.assertFalse(apply_payload['dry_run'])

        list_after_apply = self.client.get('/api/tools')
        self.assertEqual(list_after_apply.status_code, 200)
        names_after_apply = {item['name'] for item in list_after_apply.get_json()}
        self.assertIn(applied_name, names_after_apply)
        self.assertNotIn(initial_name, names_after_apply)

    def test_admin_tool_delete_honors_dry_run_and_apply(self):
        unique = uuid4().hex[:10]
        tool_name = f'Delete Tool {unique}'

        create_resp = self.client.post('/api/admin/tools', json={'name': tool_name})
        self.assertEqual(create_resp.status_code, 201, create_resp.get_data(as_text=True))
        tool_id = create_resp.get_json()['id']

        dry_run_resp = self.client.delete(
            f'/api/admin/tools/{tool_id}',
            json={'dry_run': True},
        )
        self.assertEqual(dry_run_resp.status_code, 200, dry_run_resp.get_data(as_text=True))
        dry_run_payload = dry_run_resp.get_json()
        self.assertTrue(dry_run_payload['dry_run'])
        self.assertTrue(dry_run_payload['deleted'])

        list_after_dry_run = self.client.get('/api/tools')
        self.assertEqual(list_after_dry_run.status_code, 200)
        names_after_dry_run = {item['name'] for item in list_after_dry_run.get_json()}
        self.assertIn(tool_name, names_after_dry_run)

        apply_resp = self.client.delete(
            f'/api/admin/tools/{tool_id}',
            json={'dry_run': False},
        )
        self.assertEqual(apply_resp.status_code, 200, apply_resp.get_data(as_text=True))
        apply_payload = apply_resp.get_json()
        self.assertFalse(apply_payload['dry_run'])
        self.assertTrue(apply_payload['deleted'])

        list_after_apply = self.client.get('/api/tools')
        self.assertEqual(list_after_apply.status_code, 200)
        names_after_apply = {item['name'] for item in list_after_apply.get_json()}
        self.assertNotIn(tool_name, names_after_apply)

    def test_admin_mutations_accept_form_encoded_dry_run_false(self):
        unique = uuid4().hex[:10]
        ingredient_name = f'Form Ingredient {unique}'
        tool_name = f'Form Tool {unique}'

        ingredient_id = self.client.post('/api/admin/ingredients', json={'name': ingredient_name}).get_json()['id']
        tool_id = self.client.post('/api/admin/tools', json={'name': tool_name}).get_json()['id']

        ing_rename_dry = self.client.patch(
            f'/api/admin/ingredients/{ingredient_id}',
            data={'name': f'Form Ingredient Dry {unique}', 'dry_run': 'true'},
            content_type='application/x-www-form-urlencoded',
        )
        self.assertEqual(ing_rename_dry.status_code, 200, ing_rename_dry.get_data(as_text=True))
        self.assertTrue(ing_rename_dry.get_json()['dry_run'])

        ing_rename_apply = self.client.patch(
            f'/api/admin/ingredients/{ingredient_id}',
            data={'name': f'Form Ingredient Applied {unique}', 'dry_run': 'false'},
            content_type='application/x-www-form-urlencoded',
        )
        self.assertEqual(ing_rename_apply.status_code, 200, ing_rename_apply.get_data(as_text=True))
        self.assertFalse(ing_rename_apply.get_json()['dry_run'])

        ingredient_names = {item['name'] for item in self.client.get('/api/ingredients').get_json()}
        self.assertIn(f'Form Ingredient Applied {unique}', ingredient_names)

        ing_delete_apply = self.client.delete(
            f'/api/admin/ingredients/{ingredient_id}',
            data={'dry_run': 'false'},
            content_type='application/x-www-form-urlencoded',
        )
        self.assertEqual(ing_delete_apply.status_code, 200, ing_delete_apply.get_data(as_text=True))
        self.assertFalse(ing_delete_apply.get_json()['dry_run'])
        self.assertNotIn(f'Form Ingredient Applied {unique}', {item['name'] for item in self.client.get('/api/ingredients').get_json()})

        tool_rename_dry = self.client.patch(
            f'/api/admin/tools/{tool_id}',
            data={'name': f'Form Tool Dry {unique}', 'dry_run': 'true'},
            content_type='application/x-www-form-urlencoded',
        )
        self.assertEqual(tool_rename_dry.status_code, 200, tool_rename_dry.get_data(as_text=True))
        self.assertTrue(tool_rename_dry.get_json()['dry_run'])

        tool_rename_apply = self.client.patch(
            f'/api/admin/tools/{tool_id}',
            data={'name': f'Form Tool Applied {unique}', 'dry_run': 'false'},
            content_type='application/x-www-form-urlencoded',
        )
        self.assertEqual(tool_rename_apply.status_code, 200, tool_rename_apply.get_data(as_text=True))
        self.assertFalse(tool_rename_apply.get_json()['dry_run'])
        self.assertIn(f'Form Tool Applied {unique}', {item['name'] for item in self.client.get('/api/tools').get_json()})

        tool_delete_apply = self.client.delete(
            f'/api/admin/tools/{tool_id}',
            data={'dry_run': 'false'},
            content_type='application/x-www-form-urlencoded',
        )
        self.assertEqual(tool_delete_apply.status_code, 200, tool_delete_apply.get_data(as_text=True))
        self.assertFalse(tool_delete_apply.get_json()['dry_run'])
        self.assertNotIn(f'Form Tool Applied {unique}', {item['name'] for item in self.client.get('/api/tools').get_json()})


if __name__ == '__main__':
    unittest.main()
