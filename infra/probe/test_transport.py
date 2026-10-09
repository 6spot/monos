"""Local transport/configuration checks; these do not prove installed acceptance."""
import http.server
import json
import pathlib
import ssl
import tempfile
import threading
import types
import unittest
import urllib.error
from unittest.mock import Mock, patch

from logs_probe import LogsProbe
from transport import endpoint_origin, tls_context


class TransportTests(unittest.TestCase):
    def test_origins_and_optional_ca(self):
        for endpoint in ('http://127.0.0.1:18443', 'http://192.0.2.1:18443', 'https://localhost:18443', 'http://[::1]:18443'):
            self.assertEqual(endpoint_origin(endpoint + '/'), endpoint)
        for endpoint in ('ftp://localhost', 'http://user:secret@localhost', 'https://localhost/path',
                         'http://localhost?token=x', 'http://localhost#fragment', 'http://localhost:bad',
                         'http://localhost:0', 'http://localhost:70000', 'http://', ' http://localhost'):
            with self.subTest(endpoint=endpoint), self.assertRaises(ValueError):
                endpoint_origin(endpoint)
        with patch('transport.ssl.create_default_context') as create:
            self.assertIsNone(tls_context({'endpoint': 'http://localhost'}))
            create.assert_not_called()
            with self.assertRaises(ValueError):
                tls_context({'endpoint': 'http://localhost', 'ca_file': 'ca.pem'})
        context = tls_context({'endpoint': 'https://localhost'})
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)
        with patch('transport.ssl.create_default_context', return_value=context) as create:
            with patch.object(context, 'load_verify_locations') as load:
                self.assertIs(tls_context({'endpoint': 'https://localhost', 'ca_file': 'ca.pem'}), context)
                create.assert_called_once_with()
                load.assert_called_once_with(cafile='ca.pem')
        with self.assertRaises(OSError):
            tls_context({'endpoint': 'https://localhost', 'ca_file': '/nonexistent-monos-test-ca.pem'})

    def test_http_owner_cookie_and_authenticated_recovery_without_ca(self):
        received = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                received.append((self.path, self.headers, json.loads(self.rfile.read(int(self.headers['Content-Length'])))))
                self.send_response(200)
                self.send_header('Set-Cookie', 'monos=synthetic-owner; HttpOnly; SameSite=Strict; Path=/')
                self.end_headers()
                self.wfile.write(b'{"authenticated":true}')

            def do_GET(self):
                received.append((self.path, self.headers, None))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"schema_version":1,"status":"committed","request_id":"request-one"}')

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                token = pathlib.Path(directory) / 'token'
                token.write_text('synthetic-runner-token\n')
                instance = LogsProbe.__new__(LogsProbe)
                instance.config = {'endpoint': 'http://127.0.0.1:' + str(server.server_port), 'token_file': str(token)}
                password = Mock()
                password.is_symlink.return_value = False
                password.stat.return_value = types.SimpleNamespace(st_uid=0, st_mode=0o600)
                password.read_text.return_value = 'synthetic-owner-password\n'
                with patch('logs_probe.pathlib.Path', return_value=password):
                    instance.login('/private/password')
                instance.owner('one')
                result = instance.recovery('one', 'request-one')
                self.assertEqual(result['status'], 'committed')
                self.assertEqual(received[0][1]['Origin'], instance.config['endpoint'])
                self.assertEqual(received[0][2]['password'], 'synthetic-owner-password')
                self.assertEqual(received[1][1]['Cookie'], 'monos=synthetic-owner')
                self.assertEqual(received[2][1]['Authorization'], 'Bearer synthetic-runner-token')
                self.assertIsNone(received[2][1]['Cookie'])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_owner_cookie_and_recovery_bearer_never_follow_redirect_to_other_port(self):
        source_requests = []
        destination_requests = []

        class Destination(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                destination_requests.append(self.headers)
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"status":"unknown"}')

        destination = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Destination)

        class Source(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                self.send_response(200)
                self.send_header('Set-Cookie', 'monos=synthetic-owner; HttpOnly; SameSite=Strict; Path=/')
                self.end_headers()
                self.wfile.write(b'{"authenticated":true}')

            def do_GET(self):
                source_requests.append(self.headers)
                self.send_response(302)
                self.send_header('Location', 'http://127.0.0.1:' + str(destination.server_port) + '/redirected')
                self.end_headers()

        source = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Source)
        servers = [source, destination]
        threads = [threading.Thread(target=server.serve_forever, daemon=True) for server in servers]
        for thread in threads:
            thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                token = pathlib.Path(directory) / 'token'
                token.write_text('synthetic-runner-token\n')
                instance = LogsProbe.__new__(LogsProbe)
                instance.config = {'endpoint': 'http://127.0.0.1:' + str(source.server_port), 'token_file': str(token)}
                password = Mock()
                password.is_symlink.return_value = False
                password.stat.return_value = types.SimpleNamespace(st_uid=0, st_mode=0o600)
                password.read_text.return_value = 'synthetic-owner-password\n'
                with patch('logs_probe.pathlib.Path', return_value=password):
                    instance.login('/private/password')
                for call in (lambda: instance.owner('one'), lambda: instance.recovery('one', 'request-one')):
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        call()
                    self.assertEqual(error.exception.code, 302)
                    error.exception.close()
                self.assertEqual(source_requests[0]['Cookie'], 'monos=synthetic-owner')
                self.assertEqual(source_requests[1]['Authorization'], 'Bearer synthetic-runner-token')
                self.assertEqual(destination_requests, [])
        finally:
            for server in servers:
                server.shutdown()
                server.server_close()
            for thread in threads:
                thread.join()


if __name__ == '__main__':
    unittest.main()
