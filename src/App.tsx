import './styles.css'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { RecordsProvider } from './context/RecordsContext'
import { ThemeProvider } from './context/ThemeContext'
import AppRouter from './routes/AppRouter'

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <RecordsProvider>
          <BrowserRouter>
            <AppRouter />
          </BrowserRouter>
        </RecordsProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
