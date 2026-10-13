export function csvContent(header: string[], rows: Array<Array<string | number | null | undefined>>) {
  const cell = (value: string | number | null | undefined) => {
    let text = String(value ?? '')
    if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) text = `'${text}`
    return `"${text.replace(/"/g, '""')}"`
  }
  return '\ufeff' + [header, ...rows].map(row => row.map(cell).join(',')).join('\r\n')
}

export function downloadCsv(filename: string, header: string[], rows: Array<Array<string | number | null | undefined>>) {
  const url = URL.createObjectURL(new Blob([csvContent(header, rows)], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
