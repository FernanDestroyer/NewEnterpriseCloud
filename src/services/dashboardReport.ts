import { brandLogoUrl } from '../data/helpers'
import { buildExecutiveReport, type ExecutiveReportInput } from '../data/executiveReport'
import { renderExecutiveReport } from '../data/executiveReportHtml'
import type { CompanyProfile } from './company'

type DashboardPdfOptions = ExecutiveReportInput & {
  company: CompanyProfile | null
  author?: string
  periodLabel: string
  dataNotes?: string[]
}

export async function exportExecutiveDashboard(options: DashboardPdfOptions): Promise<void> {
  // Abrir durante el clic, antes de cargar el logo, mantiene el gesto del usuario.
  const printWindow = window.open('', '_blank')
  if (!printWindow) throw new Error('El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes para exportar el PDF.')
  try {
    printWindow.document.title = 'Preparando dashboard ejecutivo…'
    const report = buildExecutiveReport(options)
    const logoUrl = await brandLogoUrl()
    if (printWindow.closed) return
    const html = renderExecutiveReport(report, {
      name: options.company?.razonSocial || 'EnterpriseCloud',
      ruc: options.company?.ruc,
      address: options.company?.direccion,
      author: options.author,
      periodLabel: options.periodLabel,
      dataNotes: options.dataNotes,
      logoUrl,
    })
    printWindow.document.open()
    printWindow.document.write(html)
    printWindow.document.close()
  } catch (error) {
    printWindow.close()
    throw error
  }
}
