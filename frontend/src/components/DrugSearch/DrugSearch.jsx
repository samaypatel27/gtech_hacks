import { useMemo, useState } from 'react'
import { mockTherapies } from './mockTherapies'
import styles from './DrugSearch.module.css'

function SearchIcon() {
  return (
    <svg
      className={styles.searchIcon}
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <line
        x1="12.5"
        y1="12.5"
        x2="16.5"
        y2="16.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * Reusable "Select a therapy" drug search UI. Route-agnostic — callers
 * decide what happens on selection via onSelectTherapy.
 */
function DrugSearch({ therapies = mockTherapies, onSelectTherapy }) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return therapies
    return therapies.filter((t) =>
      [t.name, t.generic, t.area].some((field) =>
        field.toLowerCase().includes(q),
      ),
    )
  }, [therapies, query])

  const handleSelect = (therapy) => {
    setSelectedId(therapy.id)
    onSelectTherapy?.(therapy)
  }

  return (
    <div className={styles.panel}>
      <div className={styles.heading}>
        <h1 className={styles.title}>Select a therapy</h1>
        <p className={styles.subtitle}>
          Check indication, documentation, and reimbursement readiness
          before starting treatment.
        </p>
      </div>

      <label className={styles.searchField}>
        <SearchIcon />
        <span className={styles.srOnly}>Search drug, brand, or generic name</span>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search drug, brand, or generic name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      <div className={styles.divider} />

      <div className={styles.results}>
        <span className={styles.sectionLabel}>Recently viewed</span>

        {filtered.length > 0 ? (
          <ul className={styles.list} role="listbox" aria-label="Recently viewed therapies">
            {filtered.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedId === t.id}
                  className={`${styles.row} ${selectedId === t.id ? styles.rowSelected : ''}`}
                  onClick={() => handleSelect(t)}
                >
                  <div className={styles.rowInfo}>
                    <span className={styles.drugName}>{t.name}</span>
                    <span className={styles.drugMeta}>
                      {t.generic} · {t.area}
                    </span>
                  </div>
                  <div className={styles.statusGroup}>
                    <span
                      className={`${styles.statusDot} ${styles[`status-${t.statusKey}`]}`}
                      aria-hidden="true"
                    />
                    <span className={styles.statusText}>{t.status}</span>
                    <span className={styles.arrow} aria-hidden="true">
                      &rarr;
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.emptyState}>
            No therapies match your search. Try a brand, generic, or
            therapeutic area.
          </p>
        )}
      </div>
    </div>
  )
}

export default DrugSearch
