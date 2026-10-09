"""Shared authenticated probe transport configuration; TLS always verifies peers."""
import ssl
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        # Authenticated requests stay at their configured endpoint, even for
        # same-host redirects: cookies do not distinguish destination ports.
        return None


def endpoint_origin(value):
    if not isinstance(value, str) or any(ord(char) <= 32 for char in value) or '\\' in value:
        raise ValueError('endpoint must be an HTTP(S) origin')
    parsed = urllib.parse.urlsplit(value)
    if (parsed.scheme not in ('http', 'https') or not parsed.hostname
            or parsed.username is not None or parsed.password is not None
            or parsed.path not in ('', '/') or parsed.query or parsed.fragment
            or '?' in value or '#' in value):
        raise ValueError('endpoint must be an HTTP(S) origin')
    # Accessing port validates its syntax and range before any authenticated request.
    if parsed.port == 0:
        raise ValueError('endpoint port must be positive')
    return parsed.scheme + '://' + parsed.netloc


def tls_context(config):
    endpoint = endpoint_origin(config['endpoint'])
    ca_file = config.get('ca_file')
    if endpoint.startswith('http://'):
        if ca_file:
            raise ValueError('ca_file requires an HTTPS endpoint')
        return None
    context = ssl.create_default_context()
    if ca_file:
        context.load_verify_locations(cafile=ca_file)
    return context


def authenticated_opener(config, cookie_jar=None):
    handlers = [urllib.request.HTTPSHandler(context=tls_context(config)), NoRedirect()]
    if cookie_jar is not None:
        handlers.append(urllib.request.HTTPCookieProcessor(cookie_jar))
    return urllib.request.build_opener(*handlers)
