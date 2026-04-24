"""
PowerPoint Automation Package

This package provides PowerPoint automation functionality for creating
presentations from images and exporting them to video format.
"""

from .controller import (
    PowerPointController,
    PowerPointError,
    TemplateError,
    PowerPointNotFoundError,
    ExportError,
    OperationCancelledError
)

__all__ = [
    'PowerPointController',
    'PowerPointError',
    'TemplateError',
    'PowerPointNotFoundError',
    'ExportError',
    'OperationCancelledError'
]
