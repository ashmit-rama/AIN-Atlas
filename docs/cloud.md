# Private Google Cloud handoff

No account, resource, or spend is provisioned by application startup or CI. Choose an approved Google Cloud project and a region suitable for the documents before continuing. The resource commands below are for an authorized operator **after** billing and data handling have been agreed; they are not a bootstrap step for local tests.

## 1. Choose the account and resources

Use the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install). Non-secret configuration: project ID, bucket name, Firestore database ID, Vertex location, model ID, Cloud Run service and region. Keep the local OAuth refresh token, any access token, and service-account credentials out of this repository, the browser bundle, and chat. Prefer ADC locally and a dedicated attached service account on Cloud Run. The Gemini Developer API is not used. Choose a currently supported Gemini text model **in your chosen Vertex location** using [model lifecycle](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions) and [locations](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/locations); confirm availability in this project before using company materials.

Set shell variables for the following examples. Do not paste literal angle-bracket placeholders into commands.

```bash
export PROJECT='your-approved-project-id' REGION='your-cloud-run-region'
export VERTEX_LOCATION='your-approved-vertex-location' MODEL_ID='your-supported-gemini-id'
export BUCKET='your-globally-unique-private-bucket' DATABASE='(default)'
export SERVICE='ain-atlas' REPOSITORY='ain-atlas-images'
export RUNTIME_SA="ain-atlas-runtime@${PROJECT}.iam.gserviceaccount.com"
export REVIEWER='user:founder@example.com'   # use the actual authorized reviewer's Google identity
```

An administrator may reuse existing resources. For a new isolated project where creation and spending have been authorized:

```bash
gcloud auth login
gcloud services enable aiplatform.googleapis.com firestore.googleapis.com storage.googleapis.com run.googleapis.com artifactregistry.googleapis.com iam.googleapis.com --project="$PROJECT"
gcloud iam service-accounts create ain-atlas-runtime --project="$PROJECT" --display-name='AIN Atlas runtime'
gcloud storage buckets create "gs://$BUCKET" --project="$PROJECT" --location="$REGION" --uniform-bucket-level-access --public-access-prevention
gcloud firestore databases create --project="$PROJECT" --database="$DATABASE" --location="$REGION" --type=firestore-native
gcloud artifacts repositories create "$REPOSITORY" --project="$PROJECT" --location="$REGION" --repository-format=docker
```

Select a Firestore-supported database location. Do not recreate an existing database or bucket. These independent resources, backups, retained objects, builds and stored images can incur charges even when no model is called.

## 2. Grant scoped access

Grant the runtime object **creation** and **read** on the app bucket (immutable uploads and blob reads; no application deletes), [Firestore data access](https://cloud.google.com/firestore/native/docs/security/iam), and [Vertex access](https://cloud.google.com/vertex-ai/docs/general/access-control). Use a dedicated project/database; a collection prefix is organizational, not an IAM boundary. The human browser reviewer only needs Cloud Run Invoker. The deployer separately needs image upload, Cloud Run deploy, and permission to attach the runtime service account; the runtime does not need deployment or IAM administration privileges.

```bash
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$RUNTIME_SA" --role=roles/storage.objectCreator
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$RUNTIME_SA" --role=roles/storage.objectViewer
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$RUNTIME_SA" --role=roles/datastore.user
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$RUNTIME_SA" --role=roles/aiplatform.user
```

## 3. Verify locally with ADC first

Run `gcloud auth application-default login` and `gcloud auth application-default set-quota-project "$PROJECT"`. Grant the local developer the equivalent application permissions and `serviceusage.services.use` for the quota project, or use [ADC impersonation](https://cloud.google.com/docs/authentication/set-up-adc-local-dev-environment) of the authorized runtime account. CLI login and application ADC are distinct. No downloaded key or API key is required.

Copy `.env.example` to `.env` at repository root; supply `ATLAS_PROJECT_ID`, `ATLAS_GCS_BUCKET`, `ATLAS_LOCATION`, `ATLAS_MODEL`, and set `ATLAS_FIRESTORE_DATABASE` if using a named database. Start `bash scripts/dev.sh`. The configuration banner checks whether values exist; it does **not** prove access. Check the source library, then follow the [launch checklist](launch.md). Source the shell variables above separately; `.env` is an application dotenv file, not a shell script. Before using actual documents, confirm with the founder which originals/translations are approved for this project.

## 4. Prepare one reviewed Linux image and deploy privately

Only after live local verification and separate deployment authorization:

```bash
gcloud auth configure-docker "$REGION-docker.pkg.dev"
export IMAGE="$REGION-docker.pkg.dev/$PROJECT/$REPOSITORY/ain-atlas:$(git rev-parse --short HEAD)"
docker buildx build --platform linux/amd64 --tag "$IMAGE" --push .
gcloud run deploy "$SERVICE" --image="$IMAGE" --project="$PROJECT" --region="$REGION" \
  --service-account="$RUNTIME_SA" --no-allow-unauthenticated --min-instances=0 --max-instances=1 \
  --concurrency=1 --cpu=1 --memory=1Gi --timeout=180 \
  --set-env-vars="ATLAS_PROJECT_ID=$PROJECT,ATLAS_GCS_BUCKET=$BUCKET,ATLAS_LOCATION=$VERTEX_LOCATION,ATLAS_MODEL=$MODEL_ID,ATLAS_FIRESTORE_DATABASE=$DATABASE"
gcloud run services add-iam-policy-binding "$SERVICE" --region="$REGION" --project="$PROJECT" \
  --member="$REVIEWER" --role=roles/run.invoker
```

Use a new private service or audit an existing service's IAM and invoker checks before deploying. **Never** grant `allUsers`/`allAuthenticatedUsers` or disable the invoker IAM check. Keep the default private bucket settings. Logs from stdout/stderr go to Cloud Logging. Do not turn on prompt logging, HTTP payload logging or debug tracing with company documents. Single-instance settings limit concurrency; they are not a billing commitment. Review [Cloud Run scaling limits](https://cloud.google.com/run/docs/configuring/max-instances), check budgets/alerts and actual usage, and remove unneeded resources through the owner's normal retention process.

## 5. Verify the founder's browser access

A private `run.app` URL alone is not a browser login flow. For this limited prototype use the authenticated [Cloud Run CLI proxy](https://cloud.google.com/run/docs/authenticating/developers). On the reviewer's own machine, sign in to the CLI as the authorized identity and run:

```bash
gcloud run services proxy "$SERVICE" --project="$PROJECT" --region="$REGION" --port=8080
```

Open `http://localhost:8080` on **that same machine**. The proxy attaches an identity token, and the browser loads HTML, static assets and `/api` from one origin. Install the authentication proxy component if prompted by the official CLI. Keep it bound to localhost and stop it after review. In a separate unauthenticated browser/session the direct service URL should refuse access. Verify authenticated `/healthz`, library listing, upload, generation, save, approval invalidation and reload through the proxy. Check the deployed service IAM policy and service configuration from the console. A private deployment and these checks are **pending**, not inferred from local tests. For a future login without a local CLI, design and separately test Identity-Aware Proxy rather than making the endpoint public.
