const git = require('isomorphic-git')
const fs = require('fs')

async function gitLogWithPatches(dir, filepath, limit = 100) {
  const commits = await git.log({
    fs,
    dir,
    depth: limit,
    filepath: filepath
  })

  const results: any[] = []

  for (const commit of commits) {
    const { oid: commitOid } = commit

    const parentOid = commit.parent[0] || null

    let patch = ''
    if (parentOid) {
      const { blob: oldBlob } = await git.readBlob({
        fs,
        dir,
        oid: parentOid,
        filepath: filepath
      }).catch(() => ({ blob: '' }))

      const { blob: newBlob } = await git.readBlob({
        fs,
        dir,
        oid: commitOid,
        filepath: filepath
      })

      patch = await git.diff({
        fs,
        dir,
        oldRef: parentOid,
        newRef: commitOid,
        filepath: filepath
      })
    } else {
      const { blob } = await git.readBlob({
        fs,
        dir,
        oid: commitOid,
        filepath: filepath
      })
      patch = `+${blob.toString('utf8')}`
    }

    results.push({
      oid: commitOid,
      commit: commit.commit,
      author: commit.author,
      committer: commit.committer,
      message: commit.message,
      patch: patch
    })

    if (results.length >= limit) break
  }

  return results
}

// Usage example
async function main() {
  const dir = '.' // Current directory, adjust as needed
  const filepath = 'index.js'
  const limit = 100

  try {
    const logResults = await gitLogWithPatches(dir, filepath, limit)
    for (const result of logResults) {
      console.log(`Commit: ${result.oid}`)
      console.log(`Author: ${result.author.name} <${result.author.email}>`)
      console.log(`Date: ${result.author.timestamp}`)
      console.log(`\n    ${result.message}\n`)
      console.log(`Patch:\n${result.patch}\n`)
      console.log('-'.repeat(50))
    }
  } catch (error) {
    console.error('Error:', error)
  }
}

main()