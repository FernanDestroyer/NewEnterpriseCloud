import { useNavigate } from 'react-router-dom'
import Landing from './landing/Landing'
import { useRecords } from '../context/RecordsContext'
import { useTheme } from '../context/ThemeContext'

export default function LandingPage() {
  const { theme, toggleTheme } = useTheme()
  const { records } = useRecords()
  const navigate = useNavigate()

  const enterApp = () => {
    window.scrollTo(0, 0)
    navigate('/login')
  }

  return (
    <div className="erp-shell" data-theme={theme}>
      <Landing
        theme={theme}
        onToggleTheme={toggleTheme}
        onEnter={enterApp}
        previewData={{ sales: records.sales, inventory: records.inventory, finance: records.finance }}
      />
    </div>
  )
}
