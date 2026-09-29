import unittest
from logs_probe import append_page


class OwnerResumeEvidenceTests(unittest.TestCase):
    def page(self, *sequences):
        return {'task_id': 'task_a', 'attempt_id': 'a', 'cursor': 'retained',
                'events': [{'attempt_id': 'a', 'order_sequence': n} for n in sequences]}

    def test_resume_preserves_exact_prefix(self):
        events = []
        self.assertEqual(append_page(events, self.page(1, 2), 'a'), 'retained')
        append_page(events, self.page(), 'a')
        append_page(events, self.page(3), 'a')
        self.assertEqual([e['order_sequence'] for e in events], [1, 2, 3])

    def test_rejects_duplicates_gaps_and_wrong_scope(self):
        for page in (self.page(1), self.page(3), {**self.page(2), 'task_id': 'other'}):
            with self.subTest(page=page), self.assertRaises(RuntimeError):
                append_page([{'attempt_id': 'a', 'order_sequence': 1}], page, 'a')


if __name__ == '__main__':
    unittest.main()
