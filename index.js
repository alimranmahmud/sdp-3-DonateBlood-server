require('dotenv').config();
const dns = require('dns');

const express = require('express');
const cors = require('cors');

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

if (process.env.MONGODB_URI && process.env.MONGODB_URI.startsWith('mongodb+srv://')) {
  dns.setServers(['1.1.1.1', '8.8.8.8']);
}


const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());



const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const firebaseServiceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
const firebaseServiceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
const firebaseServiceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

let serviceAccount;

if (firebaseServiceAccountJson || firebaseServiceAccountBase64) {
  const rawValue = firebaseServiceAccountJson
    ? firebaseServiceAccountJson
    : Buffer.from(firebaseServiceAccountBase64, 'base64').toString('utf8');

  try {
    serviceAccount = JSON.parse(rawValue);
  } catch (error) {
    throw new Error(
      'Failed to parse FIREBASE_SERVICE_ACCOUNT JSON. Ensure it is valid JSON or base64 in FIREBASE_SERVICE_ACCOUNT_BASE64.'
    );
  }
} else if (firebaseServiceAccountPath) {
  const resolvedPath = path.resolve(__dirname, firebaseServiceAccountPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `Firebase service account file not found at path: ${resolvedPath}`
    );
  }

  serviceAccount = require(resolvedPath);
} else {
  const candidates = ['./firebase-admin.json', './FIREBASE_SERVICE_ACCOUNT.json'];
  const foundFile = candidates.find((candidate) =>
    fs.existsSync(path.resolve(__dirname, candidate))
  );

  if (!foundFile) {
    throw new Error(
      'Firebase service account JSON not found. Add firebase-admin.json, FIREBASE_SERVICE_ACCOUNT.json, set FIREBASE_SERVICE_ACCOUNT_PATH, or set FIREBASE_SERVICE_ACCOUNT in your environment.'
    );
  }

  serviceAccount = require(path.resolve(__dirname, foundFile));
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});



// MongoDB

const uri = process.env.MONGODB_URI;


const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

let userCollections;
let requestCollections;
let notificationCollections; // 👈 globally declare

async function connectDB() {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });

    console.log("✅ Connected to MongoDB!");

    // ✅ Database + Collection define

    const database = client.db('DonateBlood');
    userCollections = database.collection('users')
    requestCollections = database.collection('request')
    notificationCollections = database.collection('notifications');

  } catch (error) {
    console.error('❌ MongoDB error:', error.message);
  }
}

connectDB();





// user------------------------------------------------------------------------------

// user profile post for registration and update profile
app.post('/users', async (req, res) => {
  const userInfo = req.body;
  userInfo.createdAt = new Date();
  userInfo.role = 'donor';
  userInfo.status = 'active';
  const result = await userCollections.insertOne(userInfo);
  res.send(result)

})

// user profile  get for all user 
app.get('/users', async (req, res) => {
  const result = await userCollections.find().toArray()
  res.status(200).send(result)
})

// user profile get for single user with email
app.get('/users/role/:email', async (req, res) => {
  const email = req.params.email;
  const query = { email: email }
  const result = await userCollections.findOne(query)
  res.send(result)
})




// My request ----------------------------------------------------------------------------------------------

app.get('/myRequest', async (req, res) => {
  try {
    const email = req.query.email;
    const size = Number(req.query.size) || 10;
    const page = Number(req.query.page) || 0;

    if (!email) {
      return res.status(400).send({ error: 'email query parameter is required' });
    }

    const query = { requesterEmail: email };

    const result = await requestCollections
      .find(query)
      .limit(size)
      .skip(page * size)
      .toArray();

    const totalRequest = await requestCollections.countDocuments(query);

    res.send({ request: result, totalRequest });

  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});


app.post('/myRequests', async (req, res) => {
  const data = req.body;
  data.createdAt = new Date();
  const result = await requestCollections.insertOne(data)
  res.send(result)

})


// All request ----------------------------------------------------------------------------------------------  
app.get('/allRequest', async (req, res) => {
  try {
    const result = await requestCollections.find().toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});



// view Details 
app.get('/viewDetails/:id', async (req, res) => {
  try {
    const id = req.params.id;

    const result = await requestCollections.findOne({
      _id: new ObjectId(id)
    });

    res.send(result);

  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

// confim 

app.patch('/viewDetails/status/:id', async (req, res) => {
  try {
    const id = req.params.id;

    const result = await requestCollections.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          donation_status: 'process'
        }
      }
    );

    res.send(result);

  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});


// Notification-----------------------------------------------------------------------------------------------------
app.get('/notifications/:email', async (req, res) => {
  const email = req.params.email;

  const result = await notificationCollections
    .find({ requesterEmail: email }) // 🔥 filter
    .toArray();

  res.send(result);
});

app.get('/notifications', async (req, res) => {
  try {
    const result = await notificationCollections.find().toArray();
    return res.send(result);
  } catch (error) {
    return res.status(500).send({ error: error.message });
  }
});


app.post('/notifications', async (req, res) => {
  const notification = req.body;

  const result = await notificationCollections.insertOne(notification);

  res.send(result);
});


// update part notification 
app.patch('/request/approve/:id', async (req, res) => {
  try {
    const id = req.params.id;

    // 🔥 1. request status update
    await requestCollections.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          donation_status: 'accepted'
        }
      }
    );

    // 🔥 2. notification status update
    await notificationCollections.updateOne(
      { requestId: id },
      {
        $set: {
          status: 'accepted'
        }
      }
    );

    res.send({ success: true });

  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});



// Delete notification
app.delete('/notifications/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const notification = await notificationCollections.findOne({
      _id: new ObjectId(id)
    });

    if (!notification) {
      return res.status(404).send({ error: 'Notification not found' });
    }

    const result = await notificationCollections.deleteOne({
      _id: new ObjectId(id)
    });

    if (notification.requestId) {
      await requestCollections.updateOne(
        { _id: new ObjectId(notification.requestId) },
        { $set: { donation_status: 'pending' } }
      );
    }

    return res.send(result);
  } catch (error) {
    return res.status(500).send({ error: error.message });
  }
});



//Search-----------------------------------------------------------------------------------------------------
app.get('/searchRequest', async (req, res) => {
  try {
    const { bloodGroup, district, upazila } = req.query;

    const query = {};

    if (bloodGroup) query.bloodGroup = bloodGroup;
    if (district) query.district = district;
    if (upazila) query.upazila = upazila;

    const result = await requestCollections.find(query).toArray();

    res.send(result);

  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});







// test route
app.get('/', (req, res) => {
  res.send('🚀 Server is running');
});

// server start
app.listen(port, () => {
  console.log(`🔥 Server running on port ${port}`);
});

