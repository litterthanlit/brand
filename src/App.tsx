import { Gallery } from './components/Gallery'
import { Studio } from './components/Studio'
import { useHashRoute } from './hooks/useHashRoute'
import { getTool } from './tools'

export default function App() {
  const route = useHashRoute()
  const tool = route.name === 'tool' ? getTool(route.id) : undefined
  if (route.name === 'tool' && tool) {
    // key: switching tools starts a fresh studio (history, locks, playback)
    return <Studio key={tool.id} tool={tool} data={route.data} />
  }
  return <Gallery />
}
