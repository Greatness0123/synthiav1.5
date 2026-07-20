# SYNTHIA: Kaggle Server Setup Guide

This guide explains how to properly launch the `kaggle_server.py` notebook on Kaggle, including how to attach models from the Kaggle sidebar to bypass slow downloads.

## 1. Setup the Notebook
1. Open a new Kaggle Notebook.
2. Under the **Settings** panel on the right:
   - **Accelerator**: Set to `GPU T4 x2` (or better).
   - **Internet**: Ensure it is turned **ON**.
3. Create a new code cell at the top of the notebook and paste the setup dependencies:
   ```python
   !pip install -q transformers accelerate bitsandbytes fastapi uvicorn pydantic laion-clap Pillow torch schedule
   ```

## 2. Attach the Qwen Model via Sidebar (Optional but Highly Recommended!)
Loading the model directly from Kaggle's storage is *much* faster than downloading it via Hugging Face.

1. On the right-hand sidebar of your Kaggle notebook, click **Add Input**.
2. Search for **Qwen2.5-VL-7B-Instruct** (or the Qwen model you are using) in the *Models* tab.
3. Click **"+"** to attach it to your notebook.
4. Kaggle will mount the model directly to your environment, usually under a path like:
   `/kaggle/input/qwen2.5-vl/transformers/7b-instruct/1`
5. *(Optional)* If your path is slightly different, find it in the sidebar file explorer under **input**, click the copy icon next to the folder, and update the `MODEL_PATH` variable on line 50 of `kaggle_server.py`. (The script automatically attempts to find it at the default path!).

*Note: The CLAP audio model is relatively small and will still automatically download when the script runs.*

## 3. Run the Server
1. Copy the entire contents of the updated `kaggle_server.py` script.
2. Paste it into a new code cell in your Kaggle Notebook.
3. **Run the cell**.

## 4. Connect to the SYNTHIA Frontend
Because the notebook uses a built-in Cloudflare Tunnel, you will see output like this after about 8-10 seconds:

```text
======================================================================
✅ TUNNEL READY!
Copy and paste this EXACT link into your God Mode Connection Panel:
👉  https://some-random-words.trycloudflare.com/infer  👈
======================================================================
```

1. Copy that specific URL (including the `/infer` at the end).
2. Open your local SYNTHIA React App.
3. Open the **God Mode** panel.
4. Paste the URL into the **"Inference Endpoint"** box.
5. Your app is now successfully routing its simulation payloads over the internet directly to your Kaggle GPUs!
