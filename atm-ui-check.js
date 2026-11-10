
    const loginView = document.querySelector("#login-view");
    const accountView = document.querySelector("#account-view");
    const transactionsView = document.querySelector("#transactions");
    const faceLoginView = document.querySelector("#face-login-view");
    const enrollView = document.querySelector("#enroll-view");
    const camera = document.querySelector("#camera");
    const startCameraButton = document.querySelector("#start-camera");
    const faceSignInButton = document.querySelector("#face-sign-in");
    const captureSampleButton = document.querySelector("#capture-sample");
    const money = cents => new Intl.NumberFormat("en-US", {
      style: "currency", currency: "USD"
    }).format(cents / 100);
    let cameraStream = null;
    let faceEnrolled = false;
    let faceSamples = [];

    async function request(path, data) {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Something went wrong.");
      return result;
    }

    function showNotice(id, message) {
      document.querySelector(id).textContent = message;
    }

    function setAuthMode(enrolling) {
      faceLoginView.classList.toggle("hidden", enrolling);
      enrollView.classList.toggle("hidden", !enrolling);
      document.querySelector("#show-enroll").classList.toggle(
        "hidden", enrolling || !faceEnrolled
      );
      document.querySelector("#cancel-enroll").classList.toggle(
        "hidden", !enrolling || !faceEnrolled
      );
      faceSignInButton.classList.toggle(
        "hidden", enrolling || !cameraStream
      );
      captureSampleButton.classList.toggle(
        "hidden", !enrolling || !cameraStream
      );
      showNotice("#login-message", "");
    }

    async function startCamera() {
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }
        });
        camera.srcObject = cameraStream;
        await camera.play();
        camera.classList.remove("hidden");
        startCameraButton.classList.add("hidden");
        setAuthMode(enrollView.classList.contains("hidden") === false);
      } catch (error) {
        cameraStream = null;
        showNotice("#login-message", "Could not access the camera. Allow camera access and try again.");
      }
    }

    function stopCamera() {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
      }
      camera.srcObject = null;
      camera.classList.add("hidden");
      startCameraButton.classList.remove("hidden");
      faceSignInButton.classList.add("hidden");
      captureSampleButton.classList.add("hidden");
    }

    function captureFaceImage() {
      if (!cameraStream || camera.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        throw new Error("Wait for the camera image, then try again.");
      }
      const canvas = document.createElement("canvas");
      canvas.width = camera.videoWidth;
      canvas.height = camera.videoHeight;
      canvas.getContext("2d").drawImage(camera, 0, 0);
      return canvas.toDataURL("image/jpeg", 0.8);
    }

    async function refreshAccount() {
      const response = await fetch("/api/account");
      if (response.status === 401) {
        stopCamera();
        loginView.classList.remove("hidden");
        accountView.classList.add("hidden");
        transactionsView.textContent = "Sign in to view your activity.";
        return;
      }
      if (!response.ok) throw new Error("Could not load account details.");
      const data = await response.json();
      stopCamera();
      loginView.classList.add("hidden");
      accountView.classList.remove("hidden");
      document.querySelector("#balance").innerHTML =
        `${money(data.balance_cents)} <small>USD</small>`;
      transactionsView.replaceChildren();
      if (data.transactions.length === 0) {
        transactionsView.className = "empty";
        transactionsView.textContent = "No transactions yet. Your activity will appear here.";
        return;
      }
      transactionsView.className = "";
      for (const transaction of data.transactions) {
        const row = document.createElement("div");
        row.className = "transaction";
        const details = document.createElement("div");
        const name = document.createElement("div");
        name.className = "transaction-name";
        name.textContent = transaction.kind;
        const date = document.createElement("div");
        date.className = "transaction-date";
        date.textContent = new Date(transaction.created_at).toLocaleString();
        details.append(name, date);
        const amount = document.createElement("div");
        amount.className = `transaction-amount ${transaction.kind === "deposit" ? "positive" : ""}`;
        amount.textContent = `${transaction.kind === "deposit" ? "+" : "−"}${money(transaction.amount_cents)}`;
        row.append(details, amount);
        transactionsView.append(row);
      }
    }

    startCameraButton.addEventListener("click", startCamera);

    faceSignInButton.addEventListener("click", async () => {
      faceSignInButton.disabled = true;
      showNotice("#login-message", "");
      try {
        await request("/api/login-face", { image: captureFaceImage() });
        await refreshAccount();
      } catch (error) {
        showNotice("#login-message", error.message);
      } finally {
        faceSignInButton.disabled = false;
      }
    });

    captureSampleButton.addEventListener("click", () => {
      if (faceSamples.length >= 5) return;
      try {
        faceSamples.push(captureFaceImage());
        document.querySelector("#sample-progress").textContent =
          `${faceSamples.length} of 5 samples captured.`;
        captureSampleButton.textContent =
          faceSamples.length === 5 ? "All samples captured" : "Capture next sample";
        captureSampleButton.disabled = faceSamples.length === 5;
      } catch (error) {
        showNotice("#login-message", error.message);
      }
    });

    enrollView.addEventListener("submit", async event => {
      event.preventDefault();
      if (faceSamples.length !== 5) {
        showNotice("#login-message", "Capture all five face samples before saving.");
        return;
      }
      const button = enrollView.querySelector('button[type="submit"]');
      button.disabled = true;
      showNotice("#login-message", "");
      try {
        await request("/api/enroll", {
          pin: document.querySelector("#enroll-pin").value,
          images: faceSamples
        });
        faceEnrolled = true;
        faceSamples = [];
        enrollView.reset();
        document.querySelector("#sample-progress").textContent = "0 of 5 samples captured.";
        captureSampleButton.textContent = "Capture sample";
        captureSampleButton.disabled = false;
        stopCamera();
        setAuthMode(false);
        showNotice("#login-message", "Face login is set up. Enable the camera to sign in.");
      } catch (error) {
        showNotice("#login-message", error.message);
      } finally {
        button.disabled = false;
      }
    });

    document.querySelector("#show-enroll").addEventListener("click", () => {
      faceSamples = [];
      document.querySelector("#sample-progress").textContent = "0 of 5 samples captured.";
      captureSampleButton.textContent = "Capture sample";
      captureSampleButton.disabled = false;
      setAuthMode(true);
    });

    document.querySelector("#cancel-enroll").addEventListener("click", () => {
      faceSamples = [];
      setAuthMode(false);
    });

    document.querySelectorAll(".action-box").forEach(form => {
      form.addEventListener("submit", async event => {
        event.preventDefault();
        const kind = form.dataset.kind;
        const amount = Number(form.querySelector("input").value);
        if (!Number.isFinite(amount) || amount <= 0) return;
        const button = form.querySelector("button");
        button.disabled = true;
        showNotice("#action-message", "");
        try {
          await request(`/api/${kind}`, { amount_cents: Math.round(amount * 100) });
          form.reset();
          await refreshAccount();
          showNotice("#action-message", `${kind === "deposit" ? "Deposit" : "Withdrawal"} complete.`);
        } catch (error) {
          showNotice("#action-message", error.message);
        } finally {
          button.disabled = false;
        }
      });
    });

    document.querySelector("#logout").addEventListener("click", async () => {
      try {
        await request("/api/logout", {});
        await refreshAccount();
      } catch (error) {
        showNotice("#action-message", error.message);
      }
    });

    async function initializeAuth() {
      const response = await fetch("/api/status");
      if (!response.ok) throw new Error("Could not check face-login setup.");
      const status = await response.json();
      faceEnrolled = status.face_enrolled;
      setAuthMode(!faceEnrolled);
    }

    Promise.all([initializeAuth(), refreshAccount()]).catch(error => {
      showNotice("#login-message", error.message);
    });
  