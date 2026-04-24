"""HTML beautifier for auto-formatting messy HTML."""
from html.parser import HTMLParser
import re


class HTMLBeautifier:
    """Format and beautify HTML code."""
    
    def __init__(self, indent_size=2):
        self.indent_size = indent_size
    
    def beautify(self, html_content):
        """
        Beautify HTML content with proper indentation.
        
        Args:
            html_content: Raw HTML string
            
        Returns:
            Formatted HTML string
        """
        try:
            # Remove extra whitespace
            html_content = re.sub(r'\s+', ' ', html_content)
            html_content = html_content.strip()
            
            # Parse and format
            formatted = self._format_html(html_content)
            
            return formatted
            
        except Exception as e:
            print(f"⚠️  Beautification failed: {e}")
            return html_content
    
    def _format_html(self, html):
        """Format HTML with proper indentation."""
        # Self-closing tags
        self_closing = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 
                       'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']
        
        # Inline tags that shouldn't cause line breaks
        inline_tags = ['a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data',
                      'dfn', 'em', 'i', 'kbd', 'mark', 'q', 's', 'samp', 'small',
                      'span', 'strong', 'sub', 'sup', 'time', 'u', 'var']
        
        result = []
        indent_level = 0
        indent = ' ' * self.indent_size
        
        # Split by tags
        parts = re.split(r'(<[^>]+>)', html)
        
        i = 0
        while i < len(parts):
            part = parts[i].strip()
            
            if not part:
                i += 1
                continue
            
            # Check if it's a tag
            if part.startswith('<'):
                tag_match = re.match(r'<(/?)(\w+)', part)
                
                if tag_match:
                    is_closing = tag_match.group(1) == '/'
                    tag_name = tag_match.group(2).lower()
                    
                    # Handle closing tags
                    if is_closing:
                        indent_level = max(0, indent_level - 1)
                        result.append(indent * indent_level + part)
                    
                    # Handle self-closing tags
                    elif tag_name in self_closing or part.endswith('/>'):
                        result.append(indent * indent_level + part)
                    
                    # Handle inline tags
                    elif tag_name in inline_tags:
                        # Keep inline with previous content
                        if result and not result[-1].endswith('>'):
                            result[-1] += part
                        else:
                            result.append(indent * indent_level + part)
                    
                    # Handle opening tags
                    else:
                        result.append(indent * indent_level + part)
                        indent_level += 1
                
                # Handle comments and special tags
                elif part.startswith('<!--') or part.startswith('<!'):
                    result.append(indent * indent_level + part)
                
                else:
                    result.append(indent * indent_level + part)
            
            # Handle text content
            else:
                # Check if next part is inline tag
                if i + 1 < len(parts):
                    next_part = parts[i + 1].strip()
                    if next_part.startswith('<'):
                        next_tag_match = re.match(r'<(/?)(\w+)', next_part)
                        if next_tag_match:
                            next_tag = next_tag_match.group(2).lower()
                            if next_tag in inline_tags:
                                # Keep inline
                                if result:
                                    result[-1] += part
                                else:
                                    result.append(indent * indent_level + part)
                                i += 1
                                continue
                
                result.append(indent * indent_level + part)
            
            i += 1
        
        return '\n'.join(result)
    
    def minify(self, html_content):
        """
        Minify HTML by removing unnecessary whitespace.
        
        Args:
            html_content: HTML string
            
        Returns:
            Minified HTML string
        """
        try:
            # Remove comments
            html_content = re.sub(r'<!--.*?-->', '', html_content, flags=re.DOTALL)
            
            # Remove whitespace between tags
            html_content = re.sub(r'>\s+<', '><', html_content)
            
            # Remove leading/trailing whitespace
            html_content = re.sub(r'\s+', ' ', html_content)
            html_content = html_content.strip()
            
            return html_content
            
        except Exception as e:
            print(f"⚠️  Minification failed: {e}")
            return html_content
    
    def validate(self, html_content):
        """
        Basic HTML validation.
        
        Args:
            html_content: HTML string
            
        Returns:
            dict with validation results
        """
        issues = []
        
        # Check for unclosed tags
        opening_tags = re.findall(r'<(\w+)[^>]*>', html_content)
        closing_tags = re.findall(r'</(\w+)>', html_content)
        
        self_closing = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 
                       'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']
        
        # Filter out self-closing tags
        opening_tags = [tag for tag in opening_tags if tag.lower() not in self_closing]
        
        # Check balance
        for tag in set(opening_tags):
            open_count = opening_tags.count(tag)
            close_count = closing_tags.count(tag)
            
            if open_count != close_count:
                issues.append(f"Unbalanced <{tag}> tags: {open_count} opening, {close_count} closing")
        
        # Check for common issues
        if '<html' not in html_content.lower():
            issues.append("Missing <html> tag")
        
        if '<head' not in html_content.lower():
            issues.append("Missing <head> tag")
        
        if '<body' not in html_content.lower():
            issues.append("Missing <body> tag")
        
        return {
            'valid': len(issues) == 0,
            'issues': issues,
            'tag_count': len(opening_tags) + len(closing_tags)
        }
