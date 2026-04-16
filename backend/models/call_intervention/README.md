# Audio Linear Classifier Model

The training script writes `audio_linear_classifier.json` into this directory by default.

Training command:

```powershell
cd E:\Fraud\fwwb\backend
python -m app.domain.call_intervention.ml.train_linear_classifier `
  --dataset-root F:/your_dataset_root `
  --output models/call_intervention/audio_linear_classifier.json
```

The current trainer assumes either:
- `dataset_root/scam/**/*.wav` and `dataset_root/normal/**/*.wav`
- or a manifest file with `path,label`

If your dataset format differs, keep the business integration unchanged and adapt only the training loader.
