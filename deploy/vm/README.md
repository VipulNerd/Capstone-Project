# Deploying MinutesAI on one Azure VM

Used because the lab sandbox does not allow Container Apps, PostgreSQL Flexible Server or
Static Web Apps. Everything runs on one Ubuntu VM with Docker:

```
Internet ──443──> Caddy (HTTPS, Let's Encrypt) ──> frontend (nginx: React app, /api proxy) ──> backend (FastAPI) ──> PostgreSQL
                                                                                                   │
                                                                                                   └──> Azure OpenAI (Foundry)
```

Only ports 80/443 are open to the internet; SSH (22) is open to your own IP only. The database and backend
have no public ports. Data lives in Docker volumes on the VM's managed disk (survives restarts and redeploys).

| Thing | Where |
|---|---|
| App secrets (DB password, `SECRET_KEY`, OpenAI key, SMTP) | `/opt/mom/.env` on the VM (chmod 600), never in git |
| Database | `pgdata` volume; daily `pg_dump` to `/opt/mom/backups` (7 days) |
| Audio chunks | `appdata` volume (`STORAGE_BACKEND=local`), deleted after transcription |
| TLS certificate | `caddy_data` volume, renewed automatically |
| SSH key | `~/.ssh/mom_vm` on your PC (and `VM_SSH_KEY` in GitHub for CI/CD) |

## Redeploy manually (from the repo root, Git Bash)
```bash
SSH_OPTS="-i ~/.ssh/mom_vm" deploy/vm/deploy.sh azureuser@<vm-dns-name>
```
It uploads the committed code (git HEAD), rebuilds, restarts, and checks `https://<vm-dns-name>/api/health`.
Rollback: `git checkout <previous-commit>` and run the same command (the database is not touched).

## Operations
| Task | Command (on the VM: `ssh -i ~/.ssh/mom_vm azureuser@<vm-dns-name>`) |
|---|---|
| Status | `cd /opt/mom/app/deploy/vm && docker compose ps` |
| Logs | `docker compose logs -f backend` (or `caddy`, `frontend`, `db`) |
| Restart | `docker compose restart backend` |
| Change a setting | edit `/opt/mom/.env`, then `docker compose up -d` |
| Database shell | `docker compose exec db psql -U mom -d mom_db` |
| Restore a backup | `docker compose exec -T db pg_restore -U mom -d mom_db --clean /backups/mom_db-YYYY-MM-DD.dump` |
| Stop paying for compute | `az vm deallocate -g <rg> -n mom-vm` (start again: `az vm start`) |

## CI/CD (GitHub Actions, `.github/workflows/deploy-vm.yml`)
Every push to `main` runs the tests, then `deploy.sh` over SSH. No Azure permissions are needed.
Repository settings → Secrets and variables → Actions:
- Variables: `VM_HOST` = the VM's DNS name, `VM_USER` = `azureuser`
- Secrets: `VM_SSH_KEY` = contents of the deploy private key, `VM_KNOWN_HOSTS` = output of `ssh-keyscan -t ed25519 <VM_HOST>`

The SSH rule only allows your IP, so for CI/CD port 22 must also accept GitHub's runners:
either open 22 to the internet (key-only login, password login is disabled) or use a self-hosted runner.
