import git from 'isomorphic-git';
import * as fs from 'fs';

import { PromiseFsClient } from 'isomorphic-git';

const fsWrapper: PromiseFsClient = {
  promises: {
    readFile: async (path, options) => {
        if (!path) return;
        try {
            const response = await fetch("http://localhost:8080/"+path);
            if (!response.ok) throw new Error('Error reading file');
            
            if (options && options.encoding === 'utf8') {
                let a = await response.text();
                return a;
            } else {
                return new Uint8Array(await response.arrayBuffer());
            }
        } catch (error) {
            console.error('Error reading file:', error);
            throw error;
        }
    },
    writeFile: async (file, data, options) => {
      const response = await fetch(`/api/fs/writeFile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file, data, options })
      });
      if (!response.ok) throw new Error('Error writing file');
    },
    unlink: async (path) => {
      const response = await fetch(`/api/fs/unlink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      });
      if (!response.ok) throw new Error('Error deleting file');
    },
    readdir: async (path, options) => {
      const response = await fetch(`/api/fs/readdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, options })
      });
      if (!response.ok) throw new Error('Error reading directory');
      return await response.json();
    },
    mkdir: async (path, options) => {
      const response = await fetch(`/api/fs/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, options })
      });
      if (!response.ok) throw new Error('Error creating directory');
    },
    rmdir: async (path) => {
      const response = await fetch(`/api/fs/rmdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      });
      if (!response.ok) throw new Error('Error removing directory');
    },
    stat: async (path) => {
      const response = await fetch(`/api/fs/stat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      });
      if (!response.ok) throw new Error('Error getting file stats');
      return await response.json();
    },
    lstat: async (path) => {
      const response = await fetch(`/api/fs/lstat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      });
      if (!response.ok) throw new Error('Error getting symbolic link stats');
      return await response.json();
    },
    readlink: async (path, options) => {
      const response = await fetch(`/api/fs/readlink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, options })
      });
      if (!response.ok) throw new Error('Error reading link');
      return await response.json();
    },
    symlink: async (target, path, type) => {
      const response = await fetch(`/api/fs/symlink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, path, type })
      });
      if (!response.ok) throw new Error('Error creating symlink');
    },
    chmod: async (path, mode) => {
      const response = await fetch(`/api/fs/chmod`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, mode })
      });
      if (!response.ok) throw new Error('Error changing file permissions');
    }
  }
};




(async () => {
const commits = await git.log({
  fs: fsWrapper,
  dir: './',
  depth: 10, // Adjust depth for more commits
});

commits.forEach(commit => {
  console.log(commit);
});
})();
