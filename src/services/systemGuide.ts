import { brandLogoUrl } from '../data/helpers'
import { renderSystemGuide } from '../data/systemGuideHtml'
import type { CompanyProfile } from './company'

type SystemGuideOptions = {
  company: CompanyProfile | null
  author?: string
}

/** Abre la guía formal del sistema en ventana de impresión (diseño ejecutivo con logo). */
export async function exportSystemGuide(options: SystemGuideOptions): Promise<void> {
  // Abrir durante el clic, antes de cargar el logo, conserva el gesto del usuario.
  const printWindow = window.open('', '_blank')
  if (!printWindow) throw new Error('El navegador bloqueó la ventana de la guía. Permite las ventanas emergentes para descargarla.')
  try {
    printWindow.document.title = 'Guía del sistema · EnterpriseCloud'
    const logoUrl = await brandLogoUrl()
    if (printWindow.closed) return
    const issued = new Date().toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'long', year: 'numeric' })
    const html = renderSystemGuide({
      companyName: options.company?.razonSocial || 'EnterpriseCloud',
      ruc: options.company?.ruc || undefined,
      address: options.company?.direccion || undefined,
      logoUrl,
      author: options.author,
      issuedLabel: issued,
      version: 'v1.1 · 2026',
    })
    printWindow.document.open()
    printWindow.document.write(html)
    printWindow.document.close()
  } catch (error) {
    printWindow.close()
    throw error
  }
}
