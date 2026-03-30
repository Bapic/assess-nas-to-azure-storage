import { useState } from 'react'
import DecisionTree from './components/DecisionTree'
import Results from './components/Results'
import { questions, outcomes } from './data/treeConfig'
import { getEligibleOutcomes, getTrackBSelection } from './utils/matchOutcomes'

function App() {
  const [answers, setAnswers] = useState(null)

  function handleComplete(userAnswers) {
    setAnswers(userAnswers)
  }

  function handleRestart() {
    setAnswers(null)
  }

  const trackAOutcomes = answers ? getEligibleOutcomes(outcomes, answers) : []
  const trackBSelection = answers
    ? getTrackBSelection(outcomes, answers, trackAOutcomes)
    : { outcomes: [], preferredByService: {}, preferredRow: null, canonicalProtocol: '', matchedPreferredToTrackA: {} }

  return (
    <div className="app">
      <div className="global-notice-banner" role="status" aria-live="polite">
        ANF implementation is not yet added
      </div>

      <header className="app-header">
        <h1>Assess NAS Sources to Azure Storage</h1>
        <p>Answer a few questions and we'll find the best options for you.</p>
      </header>

      {answers === null ? (
        <DecisionTree questions={questions} onComplete={handleComplete} />
      ) : (
        <Results
          outcomes={trackAOutcomes}
          trackBOutcomes={trackBSelection.outcomes}
          trackBPreferredByService={trackBSelection.preferredByService}
          trackBPreferredRow={trackBSelection.preferredRow}
          trackBCanonicalProtocol={trackBSelection.canonicalProtocol}
          trackBMatchedPreferredToTrackA={trackBSelection.matchedPreferredToTrackA}
          allOutcomes={outcomes}
          answers={answers}
          questions={questions}
          onRestart={handleRestart}
        />
      )}
    </div>
  )
}

export default App

