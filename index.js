const express = require('express')
const app = express()
require('dotenv').config()
const port = process.env.PORT || 3000
const cors = require('cors')
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const admin = require("firebase-admin");
const { MongoClient, ServerApiVersion } = require('mongodb');



const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString(
    'utf-8'
)
const serviceAccount = JSON.parse(decoded)

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});



// middleware
app.use(
    cors({
        origin: [
            'http://localhost:5173',
            process.env.CLIENT_DOMAIN
        ],
        credentials: true,
        optionSuccessStatus: 200,
    })
)
app.use(express.json())


// jwt middlewares
const verifyJWT = async (req, res, next) => {
    const token = req?.headers?.authorization?.split(' ')[1]
    console.log(token)
    if (!token) return res.status(401).send({ message: 'Unauthorized Access!' })
    try {
        const decoded = await admin.auth().verifyIdToken(token)
        req.tokenEmail = decoded.email
        console.log(decoded)
        next()
    } catch (err) {
        console.log(err)
        return res.status(401).send({ message: 'Unauthorized Access!', err })
    }
}








// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});





async function run() {
    try {
        await client.connect();

        const db = client.db('MealsDB')
        const MealsCollection = db.collection('meals')
        const OrderCollection = db.collection('orders')
        const ReviewCollection = db.collection('reviews')
        const UsersCollection = db.collection('users')
        const ChefRequestCollection = db.collection('chefRequests')
        const AdminRequestCollection = db.collection('adminRequests')
        const FavoriteCollection = db.collection('favorites')


        // verifyadminjwt
        const verifyAdmin = async (req, res, next) => {
            const user = await UsersCollection.findOne({
                email: req.tokenEmail
            })

            if (user?.role !== 'admin') {
                return res.status(403).send({ message: 'Forbidden Access' })
            }
            next()
        }


        //   save a meals data 
        app.post('/save-meals', verifyJWT, async (req, res) => {
            const mealsData = req.body

            const user = await UsersCollection.findOne({
                email: req.tokenEmail
            })

            // fraud chef  block
            if (user?.status === 'fraud') {
                return res.status(403).send({
                    message: 'Fraud chef cannot create meals'
                })
            }

            const result = await MealsCollection.insertOne(mealsData)
            res.send(result)
        })

        // get a meals data
        app.get('/meals', async (req, res) => {
            const result = await MealsCollection.find().toArray()
            res.send(result)

        })


        // 6 meal data 

        app.get("/latest-meals", async (req, res) => {
            const result = await MealsCollection
                .find()
                .sort({ createdAt: -1 })
                .limit(8)
                .toArray();
            res.send(result);
        });


        const { ObjectId } = require('mongodb');

        app.get('/meals/:id', async (req, res) => {
            try {
                const id = req.params.id
                const result = await MealsCollection.findOne({ _id: new ObjectId(id) })
                if (!result) return res.status(404).send({ message: 'Meal not found' })
                res.send(result)
            } catch (err) {
                console.error(err)
                res.status(500).send({ message: 'Internal Server Error', err })
            }
        })

        // payment 

        app.post('/create-checkout-session', verifyJWT, async (req, res) => {
            try {




                const user = await UsersCollection.findOne({
                    email: req.tokenEmail
                })

                //  fraud hole samne zete parbe na
                if (user?.status === 'fraud') {
                    return res.status(403).send({
                        message: 'Fraud users cannot place orders'
                    })
                }
                const paymentInfo = req.body;

                if (!paymentInfo?.price || !paymentInfo?.quantity) {
                    return res.status(400).send({ message: "Invalid payment data" });
                }

                const session = await stripe.checkout.sessions.create({
                    line_items: [
                        {
                            price_data: {
                                currency: 'usd',
                                product_data: {
                                    name: paymentInfo.foodname,
                                    images: paymentInfo.image ? [paymentInfo.image] : [],
                                },
                                unit_amount: paymentInfo.price * 100,
                            },
                            quantity: paymentInfo.quantity,
                        },
                    ],

                    customer_email: paymentInfo.customer.email,
                    mode: 'payment',

                    metadata: {
                        mealId: paymentInfo.mealId,
                        address: paymentInfo.customer.address || "",
                        customerName: paymentInfo.customer.name,
                        customerEmail: paymentInfo.customer.email,
                        quantity: paymentInfo.quantity,
                    },

                    success_url: `${process.env.CLIENT_DOMAIN}/paymentsuccessfull?session_id={CHECKOUT_SESSION_ID}`,


                    cancel_url: `${process.env.CLIENT_DOMAIN}/meal/${paymentInfo.mealId}`,


                });



                res.send({ url: session.url });
            } catch (error) {
                console.error("Stripe error:", error);
                res.status(500).send({ message: 'Payment session failed' });
            }
        });


        app.post('/paymentsuccessfull', async (req, res) => {
            const { sessionId } = req.body
            const session = await stripe.checkout.sessions.retrieve(sessionId)
            const meal = await MealsCollection.findOne({
                _id: new ObjectId(session.metadata.mealId),
            })
            const quantity = Number(session.metadata.quantity)
            const totalPrice = meal.price * quantity
            const order = await OrderCollection.findOne({
                transactionId: session.payment_intent,
            })

            if (session.status === 'complete' && meal && !order) {
                // save order data in db 
                const orderinfo = {

                    mealId: session.metadata.mealId,
                    transactionId: session.payment_intent,
                    Id: session.id,
                    customer: {
                        name: session.metadata.customerName,
                        email: session.metadata.customerEmail,
                        address: session.metadata.address
                    },

                    chef: {
                        name: meal.chef.name,
                        email: meal.chef.email,
                        uid: meal.chef.uid,
                    },


                    status: 'pending',

                    name: meal.foodname,
                    quantity: quantity,
                    price: totalPrice,
                    createdAt: new Date(),
                    image: meal?.image,
                }
                const result = await OrderCollection.insertOne(orderinfo)
                // update plant quantity
                await MealsCollection.updateOne(
                    {
                        _id: new ObjectId(session.metadata.mealId),
                    },
                    { $inc: { quantity: -quantity } }

                )

                return res.send({
                    transactionId: session.payment_intent,
                    orderId: result.insertedId,
                })
            }


        })



        app.get('/my-orders', verifyJWT, async (req, res) => {
            const result = await OrderCollection
                .find({ 'customer.email': req.tokenEmail })
                .toArray()

            res.send(result)
        })


        // review

        app.post('/reviews', verifyJWT, async (req, res) => {
            try {
                const { foodId, reviewerName, reviewerImage, rating, comment } = req.body

                if (!foodId || !rating || !comment) {
                    return res.status(400).send({ message: 'Missing review data' })
                }

                const review = {
                    foodId,
                    reviewerName,
                    reviewerImage,
                    reviewerEmail: req.tokenEmail,
                    rating: Number(rating),
                    comment,
                    date: new Date(),
                }

                // save review
                await ReviewCollection.insertOne(review)

                //  calculate average rating
                const reviews = await ReviewCollection
                    .find({ foodId })
                    .toArray()

                const avgRating =
                    reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length

                // update meal rating
                await MealsCollection.updateOne(
                    { _id: new ObjectId(foodId) },
                    { $set: { rating: Number(avgRating.toFixed(1)) } }
                )

                res.send({ success: true, message: 'Review added successfully' })
            } catch (error) {
                console.error(error)

            }
        })


        //  get my reviews
        app.get('/my-reviews', verifyJWT, async (req, res) => {
            const result = await ReviewCollection
                .find({ reviewerEmail: req.tokenEmail })
                .sort({ date: -1 })
                .toArray()

            res.send(result)
        })



        app.get('/reviews/:foodId', async (req, res) => {
            const foodId = req.params.foodId

            const result = await ReviewCollection
                .find({ foodId })
                .sort({ date: -1 })
                .toArray()

            res.send(result)
        })

        // get all meal for a chef by email
        app.get('/my-Meals/:email', async (req, res) => {
            const email = req.params.email

            const result = await MealsCollection
                .find({ 'chef.email': email })
                .toArray()
            res.send(result)
        })

        // favorites

        app.post('/favorites', verifyJWT, async (req, res) => {
            const favorite = req.body

            const exists = await FavoriteCollection.findOne({
                mealId: favorite.mealId,
                userEmail: req.tokenEmail
            })

            if (exists) {
                return res.status(409).send({ message: 'Already in favorites' })
            }

            const data = {
                ...favorite,
                userEmail: req.tokenEmail,
                addedAt: new Date()
            }

            const result = await FavoriteCollection.insertOne(data)
            res.send(result)
        })

        app.get('/favorites', verifyJWT, async (req, res) => {
            const result = await FavoriteCollection
                .find({ userEmail: req.tokenEmail })
                .sort({ addedAt: -1 })
                .toArray()

            res.send(result)
        })


        app.delete('/favorites/:id', verifyJWT, async (req, res) => {
            const id = req.params.id

            const result = await FavoriteCollection.deleteOne({
                _id: new ObjectId(id),
                userEmail: req.tokenEmail
            })

            res.send(result)
        })


        // save or update a user in db 
        app.post('/user', async (req, res) => {
            const userData = req.body
            userData.created_at = new Date().toISOString()
            userData.last_loging = new Date().toISOString()
            userData.role = 'user'
            userData.status = 'active'
            const quary = {
                email: userData.email
            }

            const alreadyExists = await UsersCollection.findOne(quary)
            console.log('user already ', !!alreadyExists)
            if (alreadyExists) {
                console.log('update user')
                const result = await UsersCollection.updateOne(quary, {
                    $set: {
                        last_loging: new Date().toISOString()
                    },
                })
                return res.send(result)

            }

            const result = await UsersCollection.insertOne(userData)
            res.send(result)
        })


        // new  add
        app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
            const adminEmail = req.tokenEmail
            const users = await UsersCollection.find({ email: { $ne: adminEmail } }).toArray()
            res.send(users)
        })


        app.patch('/users/make-fraud/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id

            const result = await UsersCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { status: 'fraud' } }
            )

            res.send(result)
        })



        app.get('/user/role', verifyJWT, async (req, res) => {
            const user = await UsersCollection.findOne({
                email: req.tokenEmail,
            });
            res.send({ role: user?.role || 'user' });
        });



        app.post('/become-chef', verifyJWT, async (req, res) => {
            const email = req.tokenEmail;
            const alreadyExists = await ChefRequestCollection.findOne({
                email,
                role: "chef",
                status: "pending",
            });

            if (alreadyExists) {
                return res.status(409).send({ message: "Already requested to become chef" });
            }
            const request = {
                email,
                role: "chef",
                status: "pending",
                requestTime: new Date(),
            };

            const result = await ChefRequestCollection.insertOne(request);
            res.send(result);
        });


        // admin requests
        app.get('/admin/requests', verifyJWT, verifyAdmin, async (req, res) => {
            const chefRequests = await ChefRequestCollection.find().toArray()
            const adminRequests = await AdminRequestCollection.find().toArray()

            const allRequests = [
                ...chefRequests.map(r => ({
                    _id: r._id,
                    userEmail: r.email,
                    requestType: 'chef',
                    requestStatus: r.status,
                    requestTime: r.requestTime
                })),
                ...adminRequests.map(r => ({
                    _id: r._id,
                    userEmail: r.email,
                    requestType: 'admin',
                    requestStatus: r.status,
                    requestTime: r.requestTime
                })),
            ]

            allRequests.sort(
                (a, b) => new Date(b.requestTime) - new Date(a.requestTime)
            )

            res.send(allRequests)
        })


        //  admin requests accept 
        app.patch(
            '/admin/requests/accept/:type/:id',
            verifyJWT,
            verifyAdmin,
            async (req, res) => {
                const { type, id } = req.params

                const requestCollection =
                    type === 'chef'
                        ? ChefRequestCollection
                        : AdminRequestCollection

                const request = await requestCollection.findOne({
                    _id: new ObjectId(id),
                })

                if (!request) {
                    return res.status(404).send({ message: 'Request not found' })
                }

                //  CHEF ACCEPT
                if (type === 'chef') {
                    const chefId = `chef-${Math.floor(1000 + Math.random() * 9000)}`

                    await UsersCollection.updateOne(
                        { email: request.email },
                        {
                            $set: {
                                role: 'chef',
                                chefId: chefId,
                            },
                        }
                    )
                }

                //  ADMIN ACCEPT
                if (type === 'admin') {
                    await UsersCollection.updateOne(
                        { email: request.email },
                        { $set: { role: 'admin' } }
                    )
                }

                //  UPDATE REQUEST STATUS
                await requestCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: 'approved' } }
                )

                res.send({ success: true, message: 'Request approved' })
            }
        )

        // reject requests
        app.patch(
            '/admin/requests/reject/:type/:id',
            verifyJWT,
            verifyAdmin,
            async (req, res) => {
                const { type, id } = req.params

                const requestCollection =
                    type === 'chef'
                        ? ChefRequestCollection
                        : AdminRequestCollection

                await requestCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: 'rejected' } }
                )

                res.send({ success: true, message: 'Request rejected' })
            }
        )





        // admin 

        app.post('/become-admin', verifyJWT, async (req, res) => {
            const email = req.tokenEmail;
            const alreadyExists = await AdminRequestCollection.findOne({
                email,
                role: "admin",
                status: "pending",
            });

            if (alreadyExists) {
                return res.status(409).send({ message: "Already requested to become admin" });
            }
            const request = {
                email,
                role: "admin",
                status: "pending",
                requestTime: new Date(),
            };

            const result = await AdminRequestCollection.insertOne(request);
            res.send(result);
        });





        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {


    }
}
run().catch(console.dir);





app.get('/', (req, res) => {
    res.send('Local Chef Bazar runnig')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
