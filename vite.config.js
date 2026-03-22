import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? ''
const isUserOrOrgSite = repositoryName.toLowerCase().endsWith('.github.io')
const base = process.env.GITHUB_ACTIONS === 'true'
  ? (isUserOrOrgSite ? '/' : `/${repositoryName}/`)
  : '/'

export default defineConfig({
  base,
  plugins: [react()],
})
