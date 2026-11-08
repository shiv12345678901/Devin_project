from .app import app
from .src.settings import settings


if __name__ == "__main__":  # pragma: no cover
    app.run(host=settings.host, port=settings.port, debug=settings.debug)

