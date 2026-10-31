"""Read VHAL xlsx cells without trusting worksheet dimension metadata. Stdlib only."""
import json
import posixpath
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
RID = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'

def texts(node):
    return ''.join(t.text or '' for t in node.iter('{%s}t' % NS['m']))

def read_book(filename):
    result = {'rows': [], 'warnings': [], 'sheets': []}
    with zipfile.ZipFile(filename) as z:
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            shared = [texts(n) for n in ET.fromstring(z.read('xl/sharedStrings.xml'))]
        rels = {r.attrib['Id']: r.attrib['Target'] for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        workbook = ET.fromstring(z.read('xl/workbook.xml'))
        for sheet in workbook.findall('m:sheets/m:sheet', NS):
            name = sheet.attrib['name']
            target = rels[sheet.attrib[RID]]
            target = target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join('xl', target))
            tree = ET.fromstring(z.read(target))
            rows = []
            for row in tree.findall('m:sheetData/m:row', NS):
                cells = {}
                for c in row.findall('m:c', NS):
                    ref = c.attrib['r']
                    v = c.find('m:v', NS)
                    value = v.text if v is not None and v.text else ''
                    if c.attrib.get('t') == 's':
                        value = shared[int(value)] if value else ''
                    elif c.attrib.get('t') == 'inlineStr':
                        value = texts(c)
                    cells[re.sub(r'\d', '', ref)] = value
                rows.append((int(row.attrib['r']), cells))
            header = None
            for number, cells in rows:
                labels = {re.sub(r'\s+', ' ', str(v)).strip().upper(): col for col, v in cells.items()}
                if 'PROJECT' in labels and 'MCU UP' in labels and 'IVI DOWN' in labels:
                    header = (number, labels['PROJECT'], labels['MCU UP'], labels['IVI DOWN'], labels.get('VEHICLE PROPERTY ID'))
                    break
            if header is None:
                # A signal/project header without a complete schema is an unsafe partial read.
                if any(re.sub(r'\s+', ' ', v).strip().upper() in ('PROJECT', 'MCU UP', 'IVI DOWN', 'VEHICLE PROPERTY ID') for _, cells in rows for v in cells.values()):
                    result['warnings'].append('工作表表头不完整：' + name)
                continue
            result['sheets'].append(name)
            number, project_col, up_col, down_col, property_col = header
            merges = [m.attrib['ref'] for m in tree.findall('m:mergeCells/m:mergeCell', NS)]
            def merged_project(n):
                for merge in merges:
                    a, b = merge.split(':')
                    ac, ar = re.match(r'([A-Z]+)(\d+)', a).groups()
                    bc, br = re.match(r'([A-Z]+)(\d+)', b).groups()
                    def colnum(c):
                        out = 0
                        for ch in c:
                            out = out * 26 + ord(ch) - 64
                        return out
                    if colnum(ac) <= colnum(project_col) <= colnum(bc) and int(ar) <= n <= int(br):
                        return True
                return False
            for n, cells in rows:
                if n <= number:
                    continue
                up, down = cells.get(up_col, ''), cells.get(down_col, '')
                property_id = cells.get(property_col, '')
                if property_id or up or down:
                    result['rows'].append({'sheet': name, 'row': n, 'project': cells.get(project_col, ''), 'propertyId': property_id, 'up': up, 'down': down, 'projectUnknown': merged_project(n)})
        if not result['sheets']:
            result['warnings'].append('未找到含 Project、MCU UP、IVI DOWN 的业务表')
    return result

if __name__ == '__main__':
    print(json.dumps(read_book(sys.argv[1]), ensure_ascii=False))
